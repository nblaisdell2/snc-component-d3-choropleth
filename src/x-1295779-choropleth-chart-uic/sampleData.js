/**
 * Built-in sample data so the component renders something meaningful the moment
 * it is dropped onto a page, before the author binds the `data` property to a
 * real data resource. Mirrors the `data` default in index.js / now-ui.json.
 *
 * Shape: a GeoJSON FeatureCollection. Each feature has:
 *   - properties: { name, id (2-letter state code), value (plausible incident count) }
 *   - geometry:  a coarse but VALID closed Polygon ring in [lon, lat] order,
 *     roughly positioned over the lower-48 United States.
 *
 * These outlines are deliberately simplified (4-6 points each) -- they are NOT
 * geographically accurate, just self-contained valid polygons placed about where
 * each state sits so the choropleth/symbol map renders on drop without any
 * external atlas / TopoJSON download. In production, authors should bind a real
 * GeoJSON (or TopoJSON-derived FeatureCollection) to the `data` property.
 *
 * Rings are CLOSED (first point repeated as last) per the GeoJSON spec.
 */
const feature = (name, id, value, coords) => ({
	type: 'Feature',
	properties: { name, id, value },
	geometry: { type: 'Polygon', coordinates: [coords] }
});

export const SAMPLE_DATA = {
	type: 'FeatureCollection',
	features: [
		// Washington (Pacific NW corner)
		feature('Washington', 'WA', 142, [
			[-124.7, 48.9], [-117.0, 49.0], [-117.0, 46.0], [-122.0, 46.2], [-124.6, 47.3], [-124.7, 48.9]
		]),
		// California (long west-coast wedge)
		feature('California', 'CA', 1180, [
			[-124.4, 42.0], [-120.0, 42.0], [-114.1, 35.0], [-114.6, 32.7], [-117.3, 32.5], [-122.4, 37.8], [-124.4, 42.0]
		]),
		// Texas (big south-central blob)
		feature('Texas', 'TX', 870, [
			[-106.6, 32.0], [-103.0, 36.5], [-100.0, 36.5], [-100.0, 34.0], [-94.0, 33.6], [-93.5, 29.8], [-97.1, 25.9], [-99.3, 26.4], [-103.0, 29.0], [-106.6, 32.0]
		]),
		// Illinois (upper-midwest vertical)
		feature('Illinois', 'IL', 410, [
			[-91.5, 42.5], [-87.5, 42.5], [-87.5, 38.0], [-89.2, 37.0], [-91.5, 40.0], [-91.5, 42.5]
		]),
		// Florida (SE peninsula)
		feature('Florida', 'FL', 760, [
			[-87.6, 31.0], [-82.0, 30.7], [-80.0, 26.7], [-80.2, 25.2], [-81.5, 25.8], [-82.8, 27.9], [-84.3, 30.0], [-87.6, 31.0]
		]),
		// New York (NE)
		feature('New York', 'NY', 690, [
			[-79.8, 43.3], [-73.3, 45.0], [-73.3, 40.9], [-74.7, 41.0], [-79.8, 42.0], [-79.8, 43.3]
		]),
		// Colorado (a clean mountain-west rectangle)
		feature('Colorado', 'CO', 230, [
			[-109.05, 41.0], [-102.05, 41.0], [-102.05, 37.0], [-109.05, 37.0], [-109.05, 41.0]
		]),
		// Georgia (SE)
		feature('Georgia', 'GA', 350, [
			[-85.6, 35.0], [-83.1, 35.0], [-81.0, 32.0], [-81.5, 30.7], [-85.0, 31.0], [-85.6, 35.0]
		])
	]
};
