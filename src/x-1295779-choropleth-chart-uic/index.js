import { createCustomElement, actionTypes } from '@servicenow/ui-core';
import snabbdom from '@servicenow/ui-renderer-snabbdom';
import styles from './styles.scss';
import { drawChart } from './chart';
import { SAMPLE_DATA } from './sampleData';

const { COMPONENT_RENDERED, COMPONENT_DOM_READY, COMPONENT_PROPERTY_CHANGED, COMPONENT_DISCONNECTED } = actionTypes;

const view = () => <div className="cc-root" />;

const getContainer = (host) =>
	host && host.shadowRoot
		? host.shadowRoot.querySelector('.cc-root') || host.shadowRoot.querySelector('div')
		: null;

const cssLen = (v, fallback) => {
	if (v === undefined || v === null || v === '') return fallback;
	return /^\d+(\.\d+)?$/.test(String(v)) ? `${v}px` : String(v);
};

/**
 * Is the `data` property a usefully populated GeoJSON FeatureCollection?
 * Accepts a FeatureCollection ({ features: [...] }), a single Feature, or a bare
 * array of features. Empty/unbound -> use the built-in sample.
 */
const hasData = (d) => {
	if (Array.isArray(d)) return d.length > 0;
	if (d && typeof d === 'object') {
		if (Array.isArray(d.features)) return d.features.length > 0;
		if (d.type === 'Feature' && d.geometry) return true;
	}
	return false;
};

const render = ({ host, properties, dispatch }) => {
	const container = getContainer(host);
	if (!container) return;
	host.style.display = 'block';
	host.style.boxSizing = 'border-box';
	host.style.width = cssLen(properties.componentWidth, '100%');
	host.style.maxWidth = '100%';
	host.style.padding = cssLen(properties.componentPadding, '0');
	// optional widget border (Header & border section)
	const borderW = parseFloat(properties.borderWidth) || 0;
	host.style.border = properties.borderColor && borderW > 0
		? `${borderW}px solid ${properties.borderColor}`
		: 'none';
	host.style.borderRadius = cssLen(properties.borderRadius, '0');
	const data = hasData(properties.data) ? properties.data : SAMPLE_DATA;
	const effectiveProps = { ...properties, data };
	host._last = { container, props: effectiveProps, dispatch };
	try {
		drawChart(container, effectiveProps, dispatch);
		host._w = container.getBoundingClientRect().width || container.clientWidth || 0;
	} catch (e) {
		container.textContent = `Chart error: ${e && e.message ? e.message : String(e)}`;
		if (typeof console !== 'undefined') console.error('[cc] render failed', e);
	}
};

createCustomElement('x-1295779-choropleth-chart-uic', {
	renderer: { type: snabbdom },
	view,
	styles,
	properties: {
		// Keep in sync with now-ui.json. JSON-typed defaults (data, values) live HERE.
		data: { default: SAMPLE_DATA },
		values: { default: null },
		chartTitle: { default: 'Incidents by State' },
		titleFontSize: { default: 18 },
		titleColor: { default: '#374151' },
		componentWidth: { default: '50%' },
		componentPadding: { default: '12px' },
		backgroundColor: { default: 'transparent' },
		borderColor: { default: '' },
		borderWidth: { default: 0 },
		borderRadius: { default: 0 },
		chartHeight: { default: 420 },
		fontFamily: { default: '' },
		animate: { default: true },
		animationDuration: { default: 800 },
		animationEasing: { default: 'cubicOut' },
		hoverHighlight: { default: true },
		hoverDimOthers: { default: false },
		projection: { default: 'albersUsa' },
		mapMode: { default: 'choropleth' },
		valueField: { default: 'value' },
		colorScaleType: { default: 'sequential' },
		colorScheme: { default: 'blues' },
		reverseColors: { default: false },
		colorMin: { default: null },
		colorMax: { default: null },
		divergingMidpoint: { default: null },
		quantizeSteps: { default: 5 },
		noDataColor: { default: '#f3f4f6' },
		landColor: { default: '#e5e7eb' },
		borderStroke: { default: '#ffffff' },
		borderStrokeWidth: { default: 0.75 },
		symbolColor: { default: '#2E93fA' },
		symbolOpacity: { default: 0.75 },
		symbolMinRadius: { default: 3 },
		symbolMaxRadius: { default: 26 },
		showLabels: { default: false },
		labelField: { default: 'name' },
		labelFontSize: { default: 10 },
		labelColor: { default: '#374151' },
		axisColor: { default: '#6b7280' },
		axisTextColor: { default: '#6b7280' },
		axisFontSize: { default: 12 },
		axisFontFamily: { default: '' },
		showColorLegend: { default: true },
		colorLegendPosition: { default: 'right' },
		colorLegendTitle: { default: '' },
		colorLegendFormat: { default: '' },
		showTooltip: { default: true },
		tooltipTemplate: { default: '{swatch}<strong>{name}</strong><br/>{formattedValue}' },
		tooltipFollowCursor: { default: true },
		tooltipBackground: { default: 'rgba(17,24,39,0.92)' },
		tooltipTextColor: { default: '#ffffff' },
		tooltipFontSize: { default: 12 }
	},
	actionHandlers: {
		[COMPONENT_RENDERED]: render,
		[COMPONENT_PROPERTY_CHANGED]: render,
		[COMPONENT_DOM_READY]: (coeffects) => {
			const { host } = coeffects;
			render(coeffects);
			if (typeof ResizeObserver !== 'undefined' && !host._ro) {
				const ro = new ResizeObserver(() => {
					const last = host._last;
					if (!last || !last.container) return;
					const wNow = last.container.getBoundingClientRect().width || last.container.clientWidth || 0;
					const prev = host._w || 0;
					if (Math.abs(wNow - prev) < 1) return;
					const wasUnsized = prev < 1;
					host._w = wNow;
					drawChart(last.container, { ...last.props, animate: wasUnsized ? last.props.animate : false }, last.dispatch);
				});
				const target = getContainer(host);
				if (target) { ro.observe(target); host._ro = ro; }
			}
		},
		[COMPONENT_DISCONNECTED]: ({ host }) => { if (host._ro) { host._ro.disconnect(); host._ro = null; } }
	}
});
