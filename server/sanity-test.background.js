/**
 * Sanity test for the D3GeoData Script Include.
 * Run in System Definition → Scripts - Background (Global scope) AFTER creating
 * the D3GeoData Script Include. Logs the value-join JSON so you can confirm the
 * `id`s line up with your atlas before wiring it in. Adjust cfg to your data.
 */
(function () {
	var api = new global.D3GeoData();

	gs.info("--- fromAggregate: incidents by state (value join) ---");
	gs.info(
		JSON.stringify(
			api.fromAggregate({
				table: "incident",
				regionField: "location.state",
				metric: "count",
				idType: "value",
				includeName: true,
			}),
			null,
			2,
		),
	);

	gs.info("--- fromRows: reshape plain {code,n,label} objects ---");
	var rows = [
		{ code: "CA", n: 1180, label: "California" },
		{ code: "TX", n: 870, label: "Texas" },
		{ code: "CA", n: 20, label: "California" },
	];
	gs.info(
		JSON.stringify(
			api.fromRows(rows, {
				idField: "code",
				valueField: "n",
				nameField: "label",
				metric: "sum",
			}),
			null,
			2,
		),
	);
})();
