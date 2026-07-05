/**
 * Script for the "D3 Choropleth FeatureCollection" Transform data resource
 * (table: sys_ux_data_broker_transform, "Mutates server data" = false).
 *
 * ADVANCED / OPTIONAL. Only needed when your geometry lives ON the platform (a
 * field that stores a GeoJSON geometry). It reads that geometry, joins the metric
 * onto each feature's properties, and returns a full FeatureCollection bound to
 * the component's "Data · Features" property. Most authors instead bind a static
 * GeoJSON/TopoJSON atlas to "Data · Features" and use the "Values" broker for the
 * metric — in that case you do NOT need this resource.
 *
 * `input` keys are the data resource's Properties (see
 * d3-choropleth-fc.properties.json). Logic lives in the global D3GeoData Script
 * Include (toFeatureCollection).
 */
function transform(input) {
	return new global.D3GeoData().toFeatureCollection(input);
}
