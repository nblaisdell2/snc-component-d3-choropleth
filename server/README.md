# server/

Platform-side sources for binding real data to the **D3 Choropleth / Symbol Map**
component. Create these as records on the instance — they are NOT shipped by
`snc ui-component deploy`; the `server/` files are the version-controlled source.

## The key idea: geometry vs. values

A choropleth needs two inputs and the component keeps them on **two separate
properties**:

- **`data`** — the map GEOMETRY: a GeoJSON `FeatureCollection`. This almost always
  comes from a **static atlas** (a GeoJSON/TopoJSON asset), *not* from the
  platform. Bind it to **Data · Features**.
- **`values`** — the METRIC per region: `[ { id, value, name? } ]`. The component
  joins each row onto a feature by `id` (or `name`) and colours it, overriding
  `feature.properties[valueField]`.

So the platform's job is to produce the **values join**, which is what
`D3GeoData` does. (It can also assemble a whole FeatureCollection in the rare case
that geometry is stored on the platform — see the optional FC broker.)

| File | What it is |
|---|---|
| `D3GeoData.js` | Script Include — `fromAggregate()`, `fromRows()`, `toFeatureCollection()` |
| `d3-choropleth-values.transform.js` | Region value-join data resource script (primary) |
| `d3-choropleth-values.properties.json` | Value-join inputs (bare array) |
| `d3-choropleth-fc.transform.js` | OPTIONAL FeatureCollection assembler script |
| `d3-choropleth-fc.properties.json` | OPTIONAL FeatureCollection inputs (bare array) |
| `sanity-test.background.js` | Logs the value-join JSON to verify the ids |

## Data brokers

- **`d3-choropleth-values`** (primary): `GlideAggregate` a table by a region field
  → `[ { id, value, name? } ]`. The `id` must match the atlas feature ids — for
  the US-states atlas use raw 2-letter codes (`idType = value`). Bind to
  **Data · Values**.
- **`d3-choropleth-fc`** (optional / advanced): only when geometry is stored ON
  the platform (a field holding a GeoJSON geometry). Reads the geometry, joins the
  metric, returns a full FeatureCollection for **Data · Features**. Skip this if
  you bind a static atlas (the common case).

Each broker created needs its **own** execute ACL.

## Setup (one time)

1. **Create the Script Include.** *System Definition → Script Includes → New*.
   Name it `D3GeoData`, **Accessible from = All application scopes**,
   **Client callable = false**, paste `D3GeoData.js`. Save.
2. **Create the Transform data resource(s).** In UI Builder: **Add data resource
   → Transform**, **Mutates server data** unchecked. Paste the matching
   `*.transform.js` into **Script** and the matching **bare JSON array**
   (`*.properties.json`) into **Properties** (must be just the `[ … ]` array).
3. **Create the execute ACL** (required — else "ACL failed for databroker"):
   broker **sys_id** from `sys_ux_data_broker_transform.list`; elevate to
   **security_admin**; **System Security → Access Control (ACL) → New**: Type =
   `ux_data_broker`, Operation = `execute`, Name = the broker sys_id (padlock →
   free text), Active = true, one permissive criterion (e.g. `UserIsAuthenticated`).

## Bind it

- **Data · Features** ← your GeoJSON atlas (static data resource / asset).
- **Data · Values** ← `@data.d3_choropleth_values.output`.
- Set the component's **`valueField`** so the join writes the value the colour
  scale reads (default `value`), and make sure the atlas feature ids match the
  join `id`s.

## Entry-point inputs

- `fromAggregate(cfg)`: `table`, `filter`, `regionField`, `metric`
  (count/sum/avg/min/max), `valueField`, `idType` (value/display), `includeName`.
- `fromRows(rows, cfg)`: `idField`, `valueField`, `nameField?`, `metric` (combine
  dups; default sum).
- `toFeatureCollection(cfg)`: `table`, `filter`, `geometryField`, `idField`,
  `nameField`, `valueField`, `recordLimit`.

## Verify

Run `sanity-test.background.js` in *Scripts - Background* (Global scope) and check
the `id`s match your atlas before wiring it into a page.

> These are **platform records** (Script Include / data resources / ACLs), not
> part of the component bundle. The GeoJSON atlas is a separate static asset, not
> one of these server objects.
