// panel/components/visualizer-schematic.js
// Schematic visualizer — the clean, technical, engineering-style view of a
// system graph. Renders nodes + edges via D3 force simulation into a target
// container element.
//
// d3 is consumed as the global window.d3, loaded by ../index.html from
// ../../lib/d3.min.js. ES modules share window globals, so referencing `d3`
// directly is valid here.
//
// Security: every string drawn from the graph (label, type, description) is
// written into the DOM via .text() (which sets textContent on SVG text) or
// via textContent on HTML elements. innerHTML is not used anywhere in this
// file, so no model-generated string can be interpreted as markup.

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

const NODE_RADIUS = 26;
const LINK_DISTANCE = 90;
const CHARGE_STRENGTH = -300;
const COLLISION_RADIUS = 38;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 3;
const EDGE_LABEL_MIN_LENGTH = 80;   // edge length (px) below which we hide the edge label
const FALLBACK_WIDTH = 360;
const FALLBACK_HEIGHT = 480;
const NODE_LABEL_DY = NODE_RADIUS + 14;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function renderSchematic(graph, container) {
  // 1) Clear any previous render. replaceChildren is the safe one-call wipe;
  //    it also detaches the old <svg> and tooltip so old simulation ticks
  //    become no-ops on garbage-collected elements.
  container.replaceChildren();

  // 2) Measure the container. If it's currently hidden (display:none) the
  //    bounding rect can be zero — fall back to a reasonable canvas size.
  const rect = container.getBoundingClientRect();
  const width  = rect.width  > 0 ? rect.width  : FALLBACK_WIDTH;
  const height = rect.height > 0 ? rect.height : FALLBACK_HEIGHT;

  // 3) Build fresh node + link copies. D3's force simulation MUTATES these
  //    (writes x, y, vx, vy on nodes; replaces source/target ids with node
  //    refs on links). We deep-copy so the caller's graph object stays
  //    pristine across re-renders and across mode toggles.
  const { nodes, links } = buildSimulationData(graph);

  // 4) SVG scaffolding: <svg> → <g zoom-root> → <g edges-layer>, <g nodes-layer>.
  //    Edges layer is appended first so it sits underneath nodes in z-order.
  const svg = d3.select(container).append('svg')
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .style('display', 'block');

  const zoomG = svg.append('g').attr('class', 'zoom-root');
  const edgesLayer = zoomG.append('g').attr('class', 'edges-layer');
  const nodesLayer = zoomG.append('g').attr('class', 'nodes-layer');

  // 5) Zoom + pan on the SVG. Transforms are applied to zoomG so the user
  //    can explore larger graphs. No translateExtent → free panning.
  const zoom = d3.zoom()
    .scaleExtent([ZOOM_MIN, ZOOM_MAX])
    .on('zoom', (event) => zoomG.attr('transform', event.transform));
  svg.call(zoom);

  // 6) Force simulation. Link distance, charge, center, and collision —
  //    the four-force recipe for a clean spread-out engineering layout.
  const simulation = d3.forceSimulation(nodes)
    .force('link',      d3.forceLink(links).id(d => d.id).distance(LINK_DISTANCE))
    .force('charge',    d3.forceManyBody().strength(CHARGE_STRENGTH))
    .force('center',    d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide(COLLISION_RADIUS));

  // 7) Edges — line element per link, plus an SVG text label at the midpoint.
  //    .text(d => d.label) safely sets textContent on the SVG text node.
  const edgeLine = edgesLayer.selectAll('line.edge')
    .data(links)
    .join('line')
    .attr('class', d => `graph-edge edge ${safeType(d.type)}`);

  const edgeLabel = edgesLayer.selectAll('text.edge-label')
    .data(links)
    .join('text')
    .attr('class', 'graph-edge-label edge-label')
    .attr('text-anchor', 'middle')
    .attr('dy', -2)
    .text(d => d.label || '');

  // 8) Nodes — each is a <g> containing a circle and a label. The group is
  //    translated to (d.x, d.y) on every tick, so circle and label move
  //    together. Drag handlers are attached to the group.
  const nodeG = nodesLayer.selectAll('g.node')
    .data(nodes)
    .join('g')
    .attr('class', d => `graph-node node ${safeType(d.type)}`)
    .style('cursor', 'grab')
    .call(d3.drag()
      .on('start', onDragStart)
      .on('drag',  onDrag)
      .on('end',   onDragEnd));

  nodeG.append('circle').attr('r', NODE_RADIUS);

  nodeG.append('text')
    .attr('class', 'graph-node-label')
    .attr('text-anchor', 'middle')
    .attr('y', NODE_LABEL_DY)
    .text(d => d.label || '');

  // 9) Hover tooltip — a single absolutely-positioned HTML element appended
  //    to the container, reused across hover events. Foundation for the
  //    click-for-details interaction we'll layer in later.
  const tooltip = makeTooltip(container);
  nodeG
    .on('mouseenter', (event, d) => showTooltip(tooltip, container, event, d))
    .on('mouseleave', () => hideTooltip(tooltip));

  // 10) Tick — update positions every simulation step.
  simulation.on('tick', () => {
    edgeLine
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);

    edgeLabel
      .attr('x', d => (d.source.x + d.target.x) / 2)
      .attr('y', d => (d.source.y + d.target.y) / 2)
      // Hide labels on edges that are too short to fit them comfortably.
      .attr('opacity', d => edgeLength(d) > EDGE_LABEL_MIN_LENGTH ? 1 : 0);

    nodeG.attr('transform', d => `translate(${d.x},${d.y})`);
  });

  // ----- Drag handlers (closed over `simulation`) --------------------------

  function onDragStart(event, d) {
    // Restart the simulation with a small alpha target so the layout
    // settles around the user's drag instead of going inert.
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  function onDrag(event, d) {
    d.fx = event.x;
    d.fy = event.y;
  }

  function onDragEnd(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    // Unfix the node so the forces take over again.
    d.fx = null;
    d.fy = null;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Build mutable simulation copies of the graph's nodes and edges. Nodes are
 * shallow-cloned. Edges are reduced to `{ source, target, label, type }` with
 * source/target normalised to string ids; edges that reference unknown nodes
 * are filtered out so the simulation can't crash on bad references.
 */
function buildSimulationData(graph) {
  const rawNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const rawEdges = Array.isArray(graph?.edges) ? graph.edges : [];

  const nodes = rawNodes.map(n => ({ ...n }));
  const nodeIds = new Set(nodes.map(n => n.id));

  const links = rawEdges
    .map(e => ({
      source: typeof e.source === 'object' ? e.source.id : e.source,
      target: typeof e.target === 'object' ? e.target.id : e.target,
      label: e.label,
      type: e.type
    }))
    .filter(l => nodeIds.has(l.source) && nodeIds.has(l.target));

  return { nodes, links };
}

/**
 * Distance between an edge's two endpoints in simulation coordinates.
 * Only valid after the simulation has assigned x/y to each node.
 */
function edgeLength(link) {
  const dx = link.target.x - link.source.x;
  const dy = link.target.y - link.source.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Lower-case + whitelist the type before using it as a CSS class. The model
 * could in principle emit a weird string; we strip anything other than
 * letters, digits, and underscores so we can't accidentally inject CSS.
 */
function safeType(type) {
  if (typeof type !== 'string') return '';
  return type.toLowerCase().replace(/[^a-z0-9_]/g, '');
}

/**
 * Create the hover tooltip element. Styled inline because it's component-
 * local and we don't want this visualizer to depend on extra CSS rules.
 */
function makeTooltip(container) {
  const tip = document.createElement('div');
  tip.className = 'schematic-tooltip';
  Object.assign(tip.style, {
    position: 'absolute',
    pointerEvents: 'none',
    background: 'rgba(22, 27, 51, 0.95)',
    color: '#E8EAF6',
    border: '1px solid #2D3561',
    borderRadius: '6px',
    padding: '8px 10px',
    fontSize: '12px',
    lineHeight: '1.4',
    maxWidth: '220px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.35)',
    display: 'none',
    zIndex: '10'
  });
  container.appendChild(tip);
  return tip;
}

/**
 * Populate and position the tooltip near the cursor. Every node string is
 * written via textContent, never as HTML.
 */
function showTooltip(tooltip, container, event, node) {
  tooltip.replaceChildren();

  const titleEl = document.createElement('div');
  titleEl.textContent = node.label || '';
  titleEl.style.fontWeight = '600';
  titleEl.style.marginBottom = '2px';
  tooltip.appendChild(titleEl);

  const typeEl = document.createElement('div');
  typeEl.textContent = node.type || '';
  typeEl.style.fontSize = '11px';
  typeEl.style.opacity = '0.7';
  typeEl.style.marginBottom = node.description ? '4px' : '0';
  tooltip.appendChild(typeEl);

  if (node.description) {
    const descEl = document.createElement('div');
    descEl.textContent = node.description;
    tooltip.appendChild(descEl);
  }

  // Position relative to the container (which is position:relative per CSS).
  const rect = container.getBoundingClientRect();
  tooltip.style.left = `${event.clientX - rect.left + 12}px`;
  tooltip.style.top  = `${event.clientY - rect.top  + 12}px`;
  tooltip.style.display = 'block';
}

function hideTooltip(tooltip) {
  tooltip.style.display = 'none';
}
