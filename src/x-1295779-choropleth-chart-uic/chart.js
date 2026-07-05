/**
 * D3 geographic choropleth / symbol map renderer.
 *
 * `drawChart` fully (re)renders the chart into `container` on every call. It owns
 * the SVG subtree imperatively while the Seismic/snabbdom view only provides the
 * stable host container. Re-rendering on each property change keeps the
 * look-and-feel fully driven by the UI Builder property panel.
 *
 * We import the specific d3 functions we use as NAMED imports (rather than
 * `import * as d3`): the ServiceNow production build tree-shakes a namespace
 * object that's passed around, which would strip methods like `select`.
 *
 * No `d3-transition` -- it gets tree-shaken out of the prod bundle. The fade-in
 * animation runs on `requestAnimationFrame`.
 *
 * dispatch(actionName, payload) emits the custom actions declared in now-ui.json
 * (CHART_CLICKED / REGION_CLICKED / REGION_HOVERED) so page authors can hook them
 * as event handlers in UI Builder.
 *
 * DATA SHAPE: a GeoJSON FeatureCollection
 *   { type:'FeatureCollection', features:[ { type:'Feature',
 *       properties:{ name, id?, value? }, geometry:{...} } ] }
 * An optional second prop `values` = [ { id, value } ] joins to features by `id`
 * or `name`; when present it OVERRIDES feature.properties[valueField]. Features
 * with no joined numeric value render in `noDataColor` (choropleth) or get no
 * symbol (symbol mode).
 *
 * Two display modes (`mapMode`):
 *   - choropleth: fill each region by value via a sequential/diverging/quantize
 *     color scale (same machinery + gradient legend as the heatmap component).
 *   - symbol: fill regions a flat `landColor` and draw a sqrt-sized circle at
 *     each region centroid.
 */
import { select } from 'd3-selection';
import { scaleSequential, scaleDiverging, scaleQuantize, scaleLinear, scaleSqrt } from 'd3-scale';
import { axisBottom, axisLeft } from 'd3-axis';
import {
	geoPath, geoMercator, geoAlbersUsa, geoEqualEarth, geoNaturalEarth1, geoOrthographic
} from 'd3-geo';
import {
	interpolateBlues, interpolateGreens, interpolateOranges, interpolateReds,
	interpolatePurples, interpolateGreys, interpolateViridis, interpolateInferno,
	interpolateMagma, interpolatePlasma, interpolateCividis, interpolateTurbo,
	interpolateWarm, interpolateCool, interpolateYlOrRd, interpolateYlGnBu,
	interpolateRdYlGn, interpolateRdBu, interpolateSpectral
} from 'd3-scale-chromatic';
import { zoom, zoomIdentity } from 'd3-zoom';
import { format } from 'd3-format';
import { color as d3color } from 'd3-color';
import { interpolateHcl } from 'd3-interpolate';
import {
	easeLinear, easeCubicOut, easeCubicInOut, easeQuadOut,
	easeExpOut, easeBackOut, easeBounceOut, easeElasticOut
} from 'd3-ease';

// Color interpolators selectable via the `colorScheme` / `valueColorScheme` properties.
const INTERPOLATORS = {
	blues: interpolateBlues,
	greens: interpolateGreens,
	oranges: interpolateOranges,
	reds: interpolateReds,
	purples: interpolatePurples,
	greys: interpolateGreys,
	viridis: interpolateViridis,
	inferno: interpolateInferno,
	magma: interpolateMagma,
	plasma: interpolatePlasma,
	cividis: interpolateCividis,
	turbo: interpolateTurbo,
	warm: interpolateWarm,
	cool: interpolateCool,
	YlOrRd: interpolateYlOrRd,
	YlGnBu: interpolateYlGnBu,
	ylOrRd: interpolateYlOrRd,
	ylGnBu: interpolateYlGnBu,
	RdYlGn: interpolateRdYlGn,
	RdBu: interpolateRdBu,
	spectral: interpolateSpectral
};

// Easing curves selectable via the `animationEasing` property.
const EASINGS = {
	linear: easeLinear,
	cubicOut: easeCubicOut,
	cubicInOut: easeCubicInOut,
	quadOut: easeQuadOut,
	expOut: easeExpOut,
	backOut: easeBackOut,
	bounceOut: easeBounceOut,
	elasticOut: easeElasticOut
};

// Projection factories selectable via the `projection` property.
const PROJECTIONS = {
	mercator: geoMercator,
	albersUsa: geoAlbersUsa,
	equalEarth: geoEqualEarth,
	naturalEarth1: geoNaturalEarth1,
	orthographic: geoOrthographic
};

const num = (v, fallback) => {
	const n = typeof v === 'string' ? parseFloat(v) : v;
	return Number.isFinite(n) ? n : fallback;
};

const isBlank = (v) => v === undefined || v === null || v === '';

/**
 * Normalize the `data` (GeoJSON FeatureCollection) + optional `values` join into
 * a clean { features, fc } where each feature carries `__name`, `__id`, `__value`.
 * `values` (array of { id, value }) overrides feature.properties[valueField] when
 * it matches by id or name.
 */
const normalizeData = (raw, values, valueField) => {
	let features = [];
	if (raw && typeof raw === 'object') {
		if (Array.isArray(raw.features)) features = raw.features;
		else if (raw.type === 'Feature') features = [raw];
		else if (Array.isArray(raw)) features = raw; // tolerate a bare array of features
	}

	// build the value-join lookup from the optional `values` prop
	const byId = {};
	const byName = {};
	if (Array.isArray(values)) {
		values.forEach((v) => {
			if (!v || typeof v !== 'object') return;
			const val = num(v.value, NaN);
			if (v.id !== undefined && v.id !== null) byId[String(v.id)] = val;
			if (v.name !== undefined && v.name !== null) byName[String(v.name)] = val;
		});
	}

	const clean = [];
	for (let i = 0; i < features.length; i += 1) {
		const f = features[i];
		if (!f || !f.geometry || f.type !== 'Feature') continue;
		const p = f.properties || {};
		const name = p.name !== undefined && p.name !== null ? String(p.name) : '';
		const id = p.id !== undefined && p.id !== null ? String(p.id) : '';

		// join precedence: values-by-id, values-by-name, then feature property
		let value = NaN;
		if (id && byId[id] !== undefined) value = byId[id];
		else if (name && byName[name] !== undefined) value = byName[name];
		else value = num(p[valueField], NaN);

		const feat = Object.assign({}, f);
		feat.__name = name;
		feat.__id = id;
		feat.__value = Number.isFinite(value) ? value : null;
		feat.__props = p;
		clean.push(feat);
	}

	const fc = { type: 'FeatureCollection', features: clean };
	return { features: clean, fc };
};

/** Relative luminance of a CSS color -> pick black or white text for contrast. */
const contrastColor = (cssColor) => {
	const c = d3color(cssColor);
	if (!c) return '#111827';
	const rgb = c.rgb();
	const lin = (v) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	};
	const L = 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
	return L > 0.55 ? '#111827' : '#ffffff';
};

/** Darken a CSS color a touch for hover outlines / strokes. */
const darken = (cssColor, k) => {
	const c = d3color(cssColor);
	if (!c) return '#111827';
	return c.darker(k).formatRgb();
};

export function drawChart(container, props, dispatch) {
	const valueField = isBlank(props.valueField) ? 'value' : String(props.valueField);

	// ----- normalize data (FeatureCollection + optional values join) -----
	const { features, fc } = normalizeData(props.data, props.values, valueField);

	// ----- normalize look-and-feel props -----
	const mapMode = props.mapMode === 'symbol' ? 'symbol' : 'choropleth';
	const projectionName = PROJECTIONS[props.projection] ? props.projection : 'albersUsa';

	const colorScaleType = ['sequential', 'diverging', 'quantize'].indexOf(props.colorScaleType) > -1 ? props.colorScaleType : 'sequential';
	// valueColorScheme wins when set; blank inherits the universal colorScheme
	const baseColorScheme = INTERPOLATORS[props.colorScheme] ? props.colorScheme : 'blues';
	const colorScheme = INTERPOLATORS[props.valueColorScheme] ? props.valueColorScheme : baseColorScheme;
	const colorMode = props.colorMode === 'custom' ? 'custom' : 'scheme';
	// custom-gradient endpoints; fall back to defaults when a color fails to parse
	const customColorStart = d3color(props.customColorStart) ? props.customColorStart : '#eff6ff';
	const customColorEnd = d3color(props.customColorEnd) ? props.customColorEnd : '#1e3a8a';
	const reverseColors = props.reverseColors === true;
	const quantizeSteps = Math.max(2, Math.round(num(props.quantizeSteps, 5)));

	const noDataColor = props.noDataColor || '#f3f4f6';
	const landColor = props.landColor || '#e5e7eb';
	const borderStroke = props.borderStroke || '#ffffff';
	const borderStrokeWidth = Math.max(0, num(props.borderStrokeWidth, 0.75));

	const symbolColor = props.symbolColor || '#2E93fA';
	const symbolOpacity = Math.max(0, Math.min(1, num(props.symbolOpacity, 0.75)));
	const symbolMinRadius = Math.max(0, num(props.symbolMinRadius, 3));
	const symbolMaxRadius = Math.max(symbolMinRadius, num(props.symbolMaxRadius, 26));

	const showLabels = props.showLabels === true;
	const labelContent = ['name', 'value', 'both'].indexOf(props.labelContent) > -1 ? props.labelContent : 'name';
	const labelField = isBlank(props.labelField) ? 'name' : String(props.labelField);
	const labelFontSize = num(props.labelFontSize, 10);
	const labelColor = props.labelColor || ''; // blank -> per-region auto contrast

	const titleFontSize = num(props.titleFontSize, 18);
	const axisFontSize = num(props.axisFontSize, 12);

	const animationDuration = Math.max(0, num(props.animationDuration, 800));
	const animate = props.animate !== false && animationDuration > 0;
	const easeFn = EASINGS[props.animationEasing] || easeCubicOut;
	const animationStagger = Math.max(0, num(props.animationStagger, 0)); // ms delay per region

	const hoverHighlight = props.hoverHighlight !== false;
	const hoverColor = props.hoverColor || '';
	const hoverDimOthers = props.hoverDimOthers === true;

	const dropShadow = props.dropShadow !== false;
	const shadowBlur = Math.max(0, num(props.shadowBlur, 4));

	const enableZoom = props.enableZoom !== false;
	const minZoom = Math.max(0.05, num(props.minZoom, 0.25));
	const maxZoom = Math.max(minZoom, num(props.maxZoom, 4));
	const showZoomControls = enableZoom && props.showZoomControls !== false;

	const showColorLegend = props.showColorLegend !== false;
	const colorLegendPosition = props.colorLegendPosition === 'bottom' ? 'bottom' : 'right';
	const colorLegendTitle = props.colorLegendTitle || '';
	const colorLegendMargin = Math.max(0, num(props.colorLegendMargin, 16));
	const colorLegendTitlePosition = ['top', 'bottom', 'left', 'right'].indexOf(props.colorLegendTitlePosition) > -1
		? props.colorLegendTitlePosition
		: 'top';

	const axisColor = props.axisColor || '#6b7280';
	const axisTextColor = props.axisTextColor || '#6b7280';
	const backgroundColor = props.backgroundColor || 'transparent';
	const fontFamily = props.fontFamily || 'inherit';
	const axisFontFamily = props.axisFontFamily || fontFamily;
	const chartTitle = props.chartTitle || '';
	const titleColor = props.titleColor || '#374151';

	const showTooltip = props.showTooltip !== false;
	const tooltipTemplate = isBlank(props.tooltipTemplate)
		? '{swatch}<strong>{name}</strong><br/>{formattedValue}'
		: props.tooltipTemplate;
	const tooltipFollowCursor = props.tooltipFollowCursor !== false;
	const tooltipBackground = props.tooltipBackground || 'rgba(17,24,39,0.92)';
	const tooltipTextColor = props.tooltipTextColor || '#ffffff';
	const tooltipFontSize = num(props.tooltipFontSize, 12);

	const makeFmt = (spec) => {
		if (isBlank(spec)) return (n) => `${n}`;
		try { return format(spec); } catch (e) { return (n) => `${n}`; }
	};
	const valueFmt = makeFmt(props.colorLegendFormat);
	const labelValueFmt = isBlank(props.labelValueFormat) ? valueFmt : makeFmt(props.labelValueFormat);

	// ----- value domain (drives the color / size scale) -----
	const finite = features.map((f) => f.__value).filter((v) => Number.isFinite(v));
	const dataMin = finite.length ? Math.min.apply(null, finite) : 0;
	const dataMax = finite.length ? Math.max.apply(null, finite) : 1;
	const dataMean = finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : 0;
	const domMin = isBlank(props.colorMin) ? dataMin : num(props.colorMin, dataMin);
	let domMax = isBlank(props.colorMax) ? dataMax : num(props.colorMax, dataMax);
	if (domMax === domMin) domMax = domMin + 1; // avoid a zero-width domain (all-equal values)

	// interpolator with optional reversal. Custom gradients interpolate in HCL for
	// perceptually even ramps; everything downstream (regions, legend, label
	// contrast) consumes `interp`.
	const baseInterp = colorMode === 'custom'
		? interpolateHcl(customColorStart, customColorEnd)
		: INTERPOLATORS[colorScheme];
	const interp = reverseColors ? (t) => baseInterp(1 - t) : baseInterp;

	// build the value -> color scale per scale type (same machinery as the heatmap)
	// clamp: values outside a fixed colorMin/colorMax domain render at the
	// endpoint colors instead of extrapolating (HCL extrapolation goes black)
	let colorScale;
	if (colorScaleType === 'diverging') {
		const autoMid = (dataMean >= domMin && dataMean <= domMax) ? dataMean : (domMin + domMax) / 2;
		const mid = isBlank(props.divergingMidpoint) ? autoMid : num(props.divergingMidpoint, autoMid);
		colorScale = scaleDiverging([domMin, mid, domMax], interp).clamp(true);
	} else if (colorScaleType === 'quantize') {
		const range = [];
		for (let i = 0; i < quantizeSteps; i += 1) {
			range.push(interp(quantizeSteps === 1 ? 0.5 : i / (quantizeSteps - 1)));
		}
		colorScale = scaleQuantize().domain([domMin, domMax]).range(range);
	} else {
		colorScale = scaleSequential([domMin, domMax], interp).clamp(true);
	}
	const colorFor = (v) => (Number.isFinite(v) ? colorScale(v) : noDataColor);

	// region fill: choropleth -> by value; symbol -> flat land color
	const fillFor = (v) => (mapMode === 'symbol' ? landColor : colorFor(v));

	// symbol size scale (sqrt so AREA encodes value)
	const sizeScale = scaleSqrt().domain([Math.min(0, domMin), domMax]).range([symbolMinRadius, symbolMaxRadius]).clamp(true);

	// ----- clear previous render -----
	const root = select(container);
	root.selectAll('*').remove();

	// ----- dimensions (width first; height depends on the sizing mode) -----
	const rect = container.getBoundingClientRect();
	const measuredW = Math.floor(rect.width) || container.clientWidth || 0;
	const width = Math.max(220, measuredW || 600);

	// ----- layout margins (computed before the svg so height can derive from them) -----
	const margin = { top: 8, right: 12, bottom: 8, left: 12 };
	if (chartTitle) margin.top += titleFontSize + 18;

	// reserve for the color legend (choropleth mode only)
	const legendThick = 14; // bar thickness
	const legendTickRoom = axisFontSize + 8; // vertical room for tick labels (bottom legend)
	const legendTitleRoom = colorLegendTitle ? axisFontSize + 6 : 0;
	// Estimate the widest tick label so the right legend reserves enough horizontal
	// room (and its title clears the labels) for whatever tick format is in use.
	const legendMaxChars = Math.max(1, ...[domMin, (domMin + domMax) / 2, domMax]
		.map((v) => String(isBlank(props.colorLegendFormat) ? v : valueFmt(v)).length));
	const estTickLabelW = Math.ceil(legendMaxChars * axisFontSize * 0.62);
	const legendTickRoomRight = 7 + estTickLabelW + 4; // label x-offset + width + pad
	const drawColorLegend = showColorLegend && mapMode === 'choropleth' && finite.length > 0;
	if (drawColorLegend) {
		if (colorLegendPosition === 'right') {
			margin.right += colorLegendMargin + legendThick + legendTickRoomRight + legendTitleRoom;
		} else {
			margin.bottom += colorLegendMargin + legendThick + legendTickRoom + legendTitleRoom;
		}
	}

	const innerW = Math.max(10, width - margin.left - margin.right);

	// ----- height: fixed px, or derived from the map's aspect at this width -----
	const heightMode = props.heightMode === 'fixed' ? 'fixed' : 'aspect';
	const projection = PROJECTIONS[projectionName]();
	let height = Math.max(120, num(props.chartHeight, 420));
	if (heightMode === 'aspect' && features.length) {
		try {
			// fit to width, then read the projected bounds to get the natural height
			projection.fitWidth(innerW, fc);
			const b = geoPath(projection).bounds(fc);
			const naturalH = Math.ceil(b[1][1] - b[0][1]);
			if (Number.isFinite(naturalH) && naturalH > 0) {
				// chartHeight acts as a minimum in aspect mode
				height = Math.max(height, margin.top + naturalH + margin.bottom);
			}
		} catch (e) { /* fall back to the fixed height */ }
	}
	const innerH = Math.max(10, height - margin.top - margin.bottom);

	// ----- root svg + chart-level click target -----
	const svg = root
		.append('svg')
		.attr('class', 'cc-svg')
		.attr('width', width).attr('height', height)
		.attr('viewBox', `0 0 ${width} ${height}`)
		.style('font-family', fontFamily)
		.style('display', 'block')
		.on('click', () => {
			dispatch('CHART_CLICKED', { regionCount: features.length });
		});

	svg.append('rect').attr('class', 'cc-bg').attr('width', width).attr('height', height).attr('fill', backgroundColor);

	// drop-shadow filter
	if (dropShadow) {
		const shadowDefs = svg.append('defs');
		const filter = shadowDefs.append('filter')
			.attr('id', 'cc-shadow')
			.attr('x', '-30%').attr('y', '-30%')
			.attr('width', '160%').attr('height', '160%');
		filter.append('feDropShadow')
			.attr('dx', 0)
			.attr('dy', 1)
			.attr('stdDeviation', shadowBlur)
			.attr('flood-color', props.shadowColor || 'rgba(0,0,0,0.25)');
	}

	// ----- title -----
	if (chartTitle) {
		svg.append('text').attr('class', 'cc-title')
			.attr('x', width / 2).attr('y', titleFontSize + 2)
			.attr('text-anchor', 'middle').attr('fill', titleColor)
			.style('font-size', `${titleFontSize}px`).style('font-weight', '600').text(chartTitle);
	}

	// ----- empty state (no throw) -----
	if (!features.length) {
		svg.append('text')
			.attr('x', width / 2).attr('y', height / 2)
			.attr('text-anchor', 'middle').attr('fill', axisColor)
			.style('font-size', `${axisFontSize}px`).text('No data to display');
		return;
	}

	// ----- projection fit to data + inner size -----
	// All chosen projections support fitSize; geoAlbersUsa has no rotate (just fitSize).
	try {
		projection.fitSize([innerW, innerH], fc);
	} catch (e) {
		// Safety net: if a projection can't fit the geometry, fall back to a mercator fit.
		try { geoMercator().fitSize([innerW, innerH], fc); } catch (e2) { /* noop */ }
	}
	const pathGen = geoPath(projection);

	// When zoom is on, the plot is wrapped in a static clipped viewport so panned/
	// zoomed content crops at the map area instead of spilling over the legend or
	// title. The margin translate lives on a wrapper group -- the zoom transform
	// owns cc-plot's own transform.
	let plotHost = svg;
	if (enableZoom) {
		svg.append('clipPath').attr('id', 'cc-clip')
			.append('rect')
			.attr('x', margin.left).attr('y', margin.top)
			.attr('width', innerW).attr('height', innerH);
		plotHost = svg.append('g').attr('class', 'cc-viewport').attr('clip-path', 'url(#cc-clip)');
	}
	const plot = plotHost.append('g')
		.attr('transform', `translate(${margin.left},${margin.top})`)
		.append('g').attr('class', 'cc-plot');

	// ----- region paths -----
	const regionLayer = plot.append('g').attr('class', 'cc-regions')
		.attr('filter', dropShadow ? 'url(#cc-shadow)' : null);
	const regionSel = regionLayer.selectAll('path').data(features).join('path')
		.attr('class', 'cc-region')
		.attr('d', (d) => pathGen(d) || '')
		.attr('fill', (d) => fillFor(d.__value))
		.attr('stroke', borderStroke && borderStrokeWidth > 0 ? borderStroke : 'none')
		.attr('stroke-width', borderStroke && borderStrokeWidth > 0 ? borderStrokeWidth : null)
		.attr('vector-effect', 'non-scaling-stroke')
		.style('cursor', 'pointer');

	// ----- symbols (symbol mode): a circle at each region centroid sized by value -----
	let symbolSel = null;
	if (mapMode === 'symbol') {
		const symData = features
			.map((d) => {
				const c = pathGen.centroid(d);
				return { feat: d, cx: c[0], cy: c[1], r: Number.isFinite(d.__value) ? sizeScale(d.__value) : 0 };
			})
			.filter((s) => Number.isFinite(s.cx) && Number.isFinite(s.cy) && s.r > 0)
			.sort((a, b) => b.r - a.r); // draw larger circles first so small ones stay clickable
		symbolSel = plot.append('g').attr('class', 'cc-symbols').selectAll('circle').data(symData).join('circle')
			.attr('class', 'cc-symbol')
			.attr('cx', (d) => d.cx).attr('cy', (d) => d.cy)
			.attr('r', (d) => d.r)
			.attr('fill', symbolColor).attr('fill-opacity', symbolOpacity)
			.attr('stroke', darken(symbolColor, 0.6)).attr('stroke-width', 0.75)
			.style('cursor', 'pointer');
	}

	// ----- region labels (centroid; hidden when the region is too small) -----
	if (showLabels) {
		const labelLayer = plot.append('g').attr('class', 'cc-labels').style('pointer-events', 'none');
		features.forEach((d) => {
			const c = pathGen.centroid(d);
			if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) return;
			const name = labelField === 'name' ? d.__name : (d.__props && d.__props[labelField] !== undefined ? String(d.__props[labelField]) : d.__name);
			const val = Number.isFinite(d.__value) ? labelValueFmt(d.__value) : null;
			const lines = (labelContent === 'value' ? [val] : labelContent === 'both' ? [name, val] : [name])
				.filter((s) => s !== null && s !== undefined && s !== '');
			if (!lines.length) return;
			const area = pathGen.area(d); // px^2 of the projected region
			// hide labels on regions too small to legibly fit text (2 lines need double)
			if (area < (labelFontSize * labelFontSize * 6 * lines.length)) return;
			// blank labelColor -> black/white picked per region for contrast
			const fill = labelColor || contrastColor(fillFor(d.__value));
			const text = labelLayer.append('text')
				.attr('x', c[0]).attr('y', c[1])
				.attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
				.attr('fill', fill)
				.style('font-size', `${labelFontSize}px`).style('font-family', fontFamily);
			// single line sits on the centroid; two lines straddle it
			lines.forEach((line, i) => {
				text.append('tspan')
					.attr('x', c[0])
					.attr('dy', i === 0 ? (lines.length > 1 ? '-0.55em' : 0) : '1.1em')
					.text(line);
			});
		});
	}

	// ----- tooltip -----
	const tooltipEl = showTooltip
		? root.append('div').attr('class', 'cc-tooltip')
			.style('background', tooltipBackground).style('color', tooltipTextColor)
			.style('font-size', `${tooltipFontSize}px`).style('font-family', fontFamily)
			.style('opacity', 0).style('display', 'none')
		: null;

	const escapeHtml = (s) => String(s)
		.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
	const swatchHtml = (cssColor) => {
		const safe = String(cssColor).replace(/[^a-zA-Z0-9#(),.%\s-]/g, '');
		return `<span class="cc-tt-swatch" style="background:${safe}"></span>`;
	};
	const renderTemplate = (d) => {
		const swatch = mapMode === 'symbol' ? symbolColor : colorFor(d.__value);
		const ctx = Object.assign({}, d.__props || {}, {
			name: d.__name,
			id: d.__id,
			value: d.__value === null ? '' : d.__value,
			formattedValue: d.__value === null ? 'no data' : valueFmt(d.__value),
			color: swatch
		});
		return tooltipTemplate.replace(/\{(\w+)\}/g, (m, key) => {
			if (key === 'swatch') return swatchHtml(swatch);
			const v = ctx[key];
			return (v === undefined || v === null) ? '' : escapeHtml(v);
		});
	};

	const placeTooltip = (clientX, clientY) => {
		if (!tooltipEl) return;
		const cr = container.getBoundingClientRect();
		const node = tooltipEl.node();
		const tw = node.offsetWidth;
		const th = node.offsetHeight;
		let xPos = clientX - cr.left + 14;
		let yPos = clientY - cr.top + 14;
		if (yPos + th > cr.height) yPos = clientY - cr.top - th - 14;
		if (xPos + tw > cr.width) xPos = cr.width - tw - 4;
		if (xPos < 0) xPos = 4;
		if (yPos < 0) yPos = 4;
		tooltipEl.style('left', `${xPos}px`).style('top', `${yPos}px`);
	};

	// ----- interaction wiring (hover highlight + dim, tooltip, click) -----
	const baseRegionOpacity = 1;
	const setHover = (d, on) => {
		if (!hoverHighlight) return;
		if (on) {
			const fill = fillFor(d.__value);
			const hovered = regionSel.filter((r) => r === d).raise()
				.attr('stroke', darken(d.__value === null ? noDataColor : fill, 1.2))
				.attr('stroke-width', Math.max(borderStrokeWidth, 1.5));
			// explicit hoverColor recolors the hovered region/symbol; blank keeps the
			// default outline-only emphasis
			if (hoverColor) {
				hovered.attr('fill', hoverColor);
				if (symbolSel) symbolSel.filter((s) => s.feat === d).attr('fill', hoverColor);
			}
			if (hoverDimOthers) {
				regionSel.filter((r) => r !== d).style('opacity', 0.35);
				if (symbolSel) symbolSel.filter((s) => s.feat !== d).style('opacity', 0.3);
			}
		} else {
			regionSel
				.attr('stroke', borderStroke && borderStrokeWidth > 0 ? borderStroke : 'none')
				.attr('stroke-width', borderStroke && borderStrokeWidth > 0 ? borderStrokeWidth : null)
				.style('opacity', baseRegionOpacity);
			if (hoverColor) {
				regionSel.attr('fill', (r) => fillFor(r.__value));
				if (symbolSel) symbolSel.attr('fill', symbolColor);
			}
			if (symbolSel) symbolSel.style('opacity', 1);
		}
	};

	const onEnter = function (event, datum) {
		const d = datum.feat ? datum.feat : datum; // symbols carry { feat }
		setHover(d, true);
		if (tooltipEl) {
			tooltipEl.html(renderTemplate(d)).style('display', 'block').style('opacity', 1);
			placeTooltip(event.clientX, event.clientY);
		}
		dispatch('REGION_HOVERED', { name: d.__name, id: d.__id, value: d.__value });
	};
	const onMove = function (event) {
		if (tooltipEl) placeTooltip(event.clientX, event.clientY);
	};
	const onLeave = function (event, datum) {
		const d = datum.feat ? datum.feat : datum;
		setHover(d, false);
		if (tooltipEl) tooltipEl.style('opacity', 0).style('display', 'none');
	};
	const onClick = function (event, datum) {
		event.stopPropagation();
		const d = datum.feat ? datum.feat : datum;
		dispatch('REGION_CLICKED', { name: d.__name, id: d.__id, value: d.__value });
	};

	regionSel.on('mouseenter', onEnter).on('mousemove', onMove).on('mouseleave', onLeave).on('click', onClick);
	if (symbolSel) symbolSel.on('mouseenter', onEnter).on('mousemove', onMove).on('mouseleave', onLeave).on('click', onClick);

	// ----- color legend (gradient bar) -- choropleth mode only -----
	if (drawColorLegend) {
		const legend = svg.append('g').attr('class', 'cc-legend');
		const defs = svg.append('defs');
		const gradId = 'cc-legend-grad';
		const STOPS = 24;
		const valueAt = (t) => domMin + t * (domMax - domMin);

		if (colorLegendPosition === 'right') {
			// title on the left of the bar reserves a slot; otherwise it sits after the ticks
			const titleLeft = colorLegendTitle && colorLegendTitlePosition === 'left';
			const mapRight = margin.left + innerW;
			const barH = Math.max(40, innerH * 0.8);
			const barX = mapRight + colorLegendMargin + (titleLeft ? legendTitleRoom : 0);
			const barY = margin.top + (innerH - barH) / 2;
			const grad = defs.append('linearGradient').attr('id', gradId)
				.attr('x1', 0).attr('y1', 1).attr('x2', 0).attr('y2', 0); // top = high value
			for (let i = 0; i <= STOPS; i += 1) {
				const t = i / STOPS;
				grad.append('stop').attr('offset', `${t * 100}%`).attr('stop-color', colorFor(valueAt(t)));
			}
			legend.append('rect')
				.attr('x', barX).attr('y', barY).attr('width', legendThick).attr('height', barH)
				.attr('fill', `url(#${gradId})`).attr('stroke', axisColor).attr('stroke-width', 0.5);

			const ls = scaleLinear().domain([domMin, domMax]).range([barY + barH, barY]);
			const axis = legend.append('g').attr('class', 'cc-legend-axis')
				.attr('transform', `translate(${barX + legendThick},0)`)
				.call(axisLeft(ls).ticks(5).tickSize(4).tickFormat(isBlank(props.colorLegendFormat) ? null : valueFmt));
			axis.selectAll('line').attr('x2', 4).attr('stroke', axisColor);
			axis.selectAll('text').attr('x', 7).style('text-anchor', 'start')
				.attr('fill', axisTextColor).style('font-size', `${axisFontSize}px`).style('font-family', axisFontFamily);
			axis.select('.domain').remove();

			if (colorLegendTitle) {
				// measure the rendered axis so a right-side title clears the actual tick labels
				const axisNode = axis.node();
				const axisW = (axisNode && axisNode.getBBox && axisNode.getBBox().width) || legendTickRoomRight;
				const titleX = titleLeft
					? mapRight + colorLegendMargin
					: barX + legendThick + axisW + axisFontSize;
				legend.append('text')
					.attr('transform', `translate(${titleX},${barY + barH / 2}) rotate(-90)`)
					.attr('text-anchor', 'middle').attr('fill', axisTextColor)
					.style('font-size', `${axisFontSize}px`).style('font-family', axisFontFamily)
					.style('font-weight', '600').text(colorLegendTitle);
			}
		} else {
			const barW = Math.max(60, innerW * 0.6);
			const barX = margin.left + (innerW - barW) / 2;
			// anchor the legend group a clean margin below the map
			const groupTop = margin.top + innerH + colorLegendMargin;
			const titleBelow = colorLegendTitle && colorLegendTitlePosition === 'bottom';
			const barY = groupTop + (colorLegendTitle && !titleBelow ? legendTitleRoom : 0);
			const grad = defs.append('linearGradient').attr('id', gradId)
				.attr('x1', 0).attr('y1', 0).attr('x2', 1).attr('y2', 0); // left = low value
			for (let i = 0; i <= STOPS; i += 1) {
				const t = i / STOPS;
				grad.append('stop').attr('offset', `${t * 100}%`).attr('stop-color', colorFor(valueAt(t)));
			}
			legend.append('rect')
				.attr('x', barX).attr('y', barY).attr('width', barW).attr('height', legendThick)
				.attr('fill', `url(#${gradId})`).attr('stroke', axisColor).attr('stroke-width', 0.5);

			const ls = scaleLinear().domain([domMin, domMax]).range([barX, barX + barW]);
			const axis = legend.append('g').attr('class', 'cc-legend-axis')
				.attr('transform', `translate(0,${barY + legendThick})`)
				.call(axisBottom(ls).ticks(5).tickSize(4).tickFormat(isBlank(props.colorLegendFormat) ? null : valueFmt));
			axis.selectAll('line').attr('stroke', axisColor);
			axis.selectAll('text').attr('fill', axisTextColor)
				.style('font-size', `${axisFontSize}px`).style('font-family', axisFontFamily);
			axis.select('.domain').remove();

			if (colorLegendTitle) {
				const titleY = titleBelow
					? barY + legendThick + legendTickRoom + axisFontSize
					: groupTop + axisFontSize;
				legend.append('text')
					.attr('x', barX + barW / 2).attr('y', titleY)
					.attr('text-anchor', 'middle').attr('fill', axisTextColor)
					.style('font-size', `${axisFontSize}px`).style('font-family', axisFontFamily)
					.style('font-weight', '600').text(colorLegendTitle);
			}
		}
	}

	// ----- size hint (symbol mode) -----
	if (mapMode === 'symbol' && showColorLegend && finite.length > 0) {
		const hintR = Math.max(symbolMinRadius + 1, Math.min(symbolMaxRadius, sizeScale(domMax)));
		const hint = svg.append('g').attr('class', 'cc-size-hint');
		const hx = margin.left + 14;
		const hy = height - margin.bottom - hintR - 4;
		hint.append('circle').attr('cx', hx).attr('cy', hy).attr('r', hintR)
			.attr('fill', symbolColor).attr('fill-opacity', symbolOpacity)
			.attr('stroke', darken(symbolColor, 0.6)).attr('stroke-width', 0.75);
		hint.append('text').attr('x', hx + hintR + 6).attr('y', hy)
			.attr('dominant-baseline', 'central').attr('fill', axisTextColor)
			.style('font-size', `${axisFontSize}px`).style('font-family', axisFontFamily)
			.text(`= ${valueFmt(domMax)}`);
	}

	// ----- fade-in animation (regions + symbols) via requestAnimationFrame -----
	if (animate && typeof requestAnimationFrame === 'function') {
		const nowFn = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : new Date().getTime());
		const t0 = nowFn();
		regionSel.style('opacity', 0);
		if (symbolSel) symbolSel.style('opacity', 0);
		const tick = () => {
			const elapsed = nowFn() - t0;
			const k = easeFn(Math.max(0, Math.min(1, elapsed / animationDuration)));
			regionSel.style('opacity', k);
			if (symbolSel) symbolSel.style('opacity', k);
			if (elapsed < animationDuration) {
				requestAnimationFrame(tick);
			} else {
				regionSel.style('opacity', baseRegionOpacity);
				if (symbolSel) symbolSel.style('opacity', 1);
			}
		};
		requestAnimationFrame(tick);
	}
}
