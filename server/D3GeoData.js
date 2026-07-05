/**
 * D3GeoData — Script Include (global, accessible from all application scopes,
 * Client callable = false)
 * ---------------------------------------------------------------------------
 * Feeds the x-2114311-choropleth-chart-uic component. A choropleth needs TWO
 * things: map GEOMETRY (a GeoJSON FeatureCollection) and a METRIC per region.
 * The geometry almost always comes from a static atlas (a GeoJSON/TopoJSON asset
 * bound to the component's `data` property), NOT from the platform — so this
 * Script Include's main job is to produce the **value join** bound to the
 * component's separate `values` property:
 *
 *   [ { id, value, name? }, ... ]
 *
 * The component joins each row onto a feature by `id` (or `name`) and colours it,
 * overriding feature.properties[valueField]. Set the component's `valueField`
 * accordingly (default 'value').
 *
 * Entry points:
 *   - fromAggregate(cfg)      : GlideAggregate a table by a region field ->
 *                               [ { id, value, name? } ] join rows. (primary)
 *   - fromRows(rows, cfg)     : reshape already-fetched rows into join rows.
 *   - toFeatureCollection(cfg): ADVANCED — when geometry is stored ON the platform
 *                               (a field holding a GeoJSON geometry), read it and
 *                               join the metric -> a full FeatureCollection bound
 *                               to `data`. Most authors won't need this.
 *
 * Written in ES5 for broad scoped/global compatibility (no let/const, arrow
 * functions, or template literals).
 */
var D3GeoData = Class.create();
D3GeoData.prototype = {
	initialize: function () {},

	/**
	 * Aggregate a table by a region field into value-join rows.
	 * cfg: {
	 *   table, filter,
	 *   regionField (the field identifying the region, e.g. 'location.state',
	 *                'u_state', 'country'),
	 *   metric (count|sum|avg|min|max), valueField (required if metric!=count),
	 *   idType ('value' = raw value as the join id [default], 'display' = display
	 *           value as the join id), useDisplayValue (default true; controls the
	 *           `name`), includeName (default true)
	 * }
	 * Returns: [ { id, value, name? }, … ]
	 */
	fromAggregate: function (cfg) {
		cfg = cfg || {};
		var table = this._str(cfg.table);
		var regionField = this._str(cfg.regionField);
		if (!table || !regionField) {
			return [];
		}
		var metric = (this._str(cfg.metric) || "count").toLowerCase();
		var valueField = this._str(cfg.valueField);
		if (metric !== "count" && !valueField) {
			return [];
		}
		var idType = (this._str(cfg.idType) || "value").toLowerCase();
		var includeName = cfg.includeName !== false && cfg.includeName !== "false";

		var ga = new GlideAggregate(table);
		if (this._str(cfg.filter)) {
			ga.addEncodedQuery(cfg.filter);
		}
		ga.groupBy(regionField);
		if (metric === "count") {
			ga.addAggregate("COUNT");
		} else {
			ga.addAggregate(metric.toUpperCase(), valueField);
		}
		ga.query();

		var out = [];
		while (ga.next()) {
			var raw = ga.getValue(regionField);
			var disp = ga.getDisplayValue(regionField);
			var id = idType === "display" ? disp : raw;
			if (id === null || id === undefined || id === "") {
				continue;
			}
			var value;
			if (metric === "count") {
				value = parseInt(ga.getAggregate("COUNT"), 10);
			} else {
				value = parseFloat(ga.getAggregate(metric.toUpperCase(), valueField));
			}
			var entry = { id: "" + id, value: isNaN(value) ? 0 : value };
			if (includeName && disp !== null && disp !== undefined && disp !== "") {
				entry.name = "" + disp;
			}
			out.push(entry);
		}
		return out;
	},

	/**
	 * Reshape already-fetched rows into value-join rows.
	 * cfg: { idField (default 'id'), valueField (default 'value'),
	 *        nameField?, metric? (combine dups; default sum) }
	 */
	fromRows: function (rows, cfg) {
		cfg = cfg || {};
		rows = rows || [];
		var idField = this._str(cfg.idField) || "id";
		var valueField = this._str(cfg.valueField) || "value";
		var nameField = this._str(cfg.nameField);
		var metric = (this._str(cfg.metric) || "sum").toLowerCase();

		var map = {};
		var names = {};
		var counts = {};
		var order = [];
		for (var i = 0; i < rows.length; i++) {
			var r = rows[i] || {};
			var id = this._str(this._readField(r, idField));
			if (!id) {
				continue;
			}
			var v = parseFloat(this._readField(r, valueField));
			if (isNaN(v)) {
				v = metric === "count" ? 1 : 0;
			}
			if (map[id] === undefined) {
				map[id] = metric === "count" ? 1 : v;
				counts[id] = 1;
				order.push(id);
				if (nameField) {
					names[id] = "" + this._readField(r, nameField);
				}
			} else {
				if (metric === "count") {
					map[id] += 1;
				} else if (metric === "min") {
					map[id] = Math.min(map[id], v);
				} else if (metric === "max") {
					map[id] = Math.max(map[id], v);
				} else {
					map[id] += v;
				}
				counts[id]++;
			}
		}
		if (metric === "avg") {
			for (var k in map) {
				if (map.hasOwnProperty(k)) {
					map[k] = map[k] / counts[k];
				}
			}
		}
		var out = [];
		for (var j = 0; j < order.length; j++) {
			var oid = order[j];
			var entry = { id: oid, value: map[oid] };
			if (nameField && names[oid]) {
				entry.name = names[oid];
			}
			out.push(entry);
		}
		return out;
	},

	/**
	 * ADVANCED — assemble a full GeoJSON FeatureCollection from a table that
	 * stores geometry. Bind the result to the component's `data` property.
	 * cfg: {
	 *   table, filter,
	 *   geometryField (field holding a GeoJSON geometry, as a JSON string or a
	 *                  Feature/geometry object),
	 *   idField, nameField,
	 *   metric (count|sum|avg|min|max — over the SAME table, per record group is
	 *           not applied here; value is read per record), valueField,
	 *   recordLimit (default 5000)
	 * }
	 * Returns: { type:'FeatureCollection', features:[ { type:'Feature',
	 *            properties:{ id, name, value }, geometry } ] }
	 */
	toFeatureCollection: function (cfg) {
		cfg = cfg || {};
		var table = this._str(cfg.table);
		var geometryField = this._str(cfg.geometryField);
		if (!table || !geometryField) {
			return { type: "FeatureCollection", features: [] };
		}
		var idField = this._str(cfg.idField);
		var nameField = this._str(cfg.nameField);
		var valueField = this._str(cfg.valueField);
		var recordLimit = parseInt(cfg.recordLimit, 10);
		if (isNaN(recordLimit) || recordLimit <= 0) {
			recordLimit = 5000;
		}

		var gr = new GlideRecord(table);
		if (this._str(cfg.filter)) {
			gr.addEncodedQuery(cfg.filter);
		}
		gr.setLimit(recordLimit);
		gr.query();

		var features = [];
		while (gr.next()) {
			var geom = this._parseGeometry(gr.getValue(geometryField));
			if (!geom) {
				continue;
			}
			var props = {};
			if (idField) {
				props.id = "" + gr.getValue(idField);
			}
			if (nameField) {
				props.name = "" + gr.getDisplayValue(nameField);
			}
			if (valueField) {
				var v = parseFloat(gr.getValue(valueField));
				props.value = isNaN(v) ? 0 : v;
			}
			features.push({ type: "Feature", properties: props, geometry: geom });
		}
		return { type: "FeatureCollection", features: features };
	},

	// ----- internals -------------------------------------------------------

	/** Accept a geometry string/object and return a plain GeoJSON geometry. */
	_parseGeometry: function (raw) {
		if (raw === null || raw === undefined || raw === "") {
			return null;
		}
		var obj = raw;
		if (typeof raw === "string") {
			try {
				obj = JSON.parse(raw);
			} catch (e) {
				return null;
			}
		}
		if (!obj || typeof obj !== "object") {
			return null;
		}
		if (obj.type === "Feature" && obj.geometry) {
			return obj.geometry;
		}
		if (obj.geometry && obj.geometry.type) {
			return obj.geometry;
		}
		if (obj.type && obj.coordinates) {
			return obj;
		}
		return null;
	},

	_readField: function (obj, field) {
		if (!field) {
			return "";
		}
		var v = obj[field];
		if (v && typeof v === "object") {
			if (typeof v.getDisplayValue === "function") {
				return v.getDisplayValue();
			}
			if (v.displayValue !== undefined) {
				return v.displayValue;
			}
			if (v.value !== undefined) {
				return v.value;
			}
		}
		return v === undefined || v === null ? "" : v;
	},

	_str: function (v) {
		return v === undefined || v === null
			? ""
			: ("" + v).replace(/^\s+|\s+$/g, "");
	},

	type: "D3GeoData",
};
