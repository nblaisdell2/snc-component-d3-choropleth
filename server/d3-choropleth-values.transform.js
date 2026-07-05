/**
 * Script for the "D3 Choropleth Values" Transform data resource
 * (table: sys_ux_data_broker_transform, "Mutates server data" = false).
 *
 * Paste this into the data resource's Script field. `input` is an object whose
 * keys are the data resource's Properties (see d3-choropleth-values.properties.json).
 * The returned value is the data resource output, bound in UI Builder via
 *   @data.<data_resource_name>.output
 * to the component's "Data · Values" property (NOT "Data · Features" — that holds
 * the GeoJSON atlas geometry).
 *
 * Aggregates a table by a region field into [ { id, value, name? } ] join rows.
 * The `id` must match the atlas features' id/name. All logic lives in the global
 * D3GeoData Script Include.
 */
function transform(input) {
	return new global.D3GeoData().fromAggregate(input);
}
