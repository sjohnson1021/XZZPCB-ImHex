/* render_layers.js
 * Loads PCB data from JSON/PCB files and renders with SVG
 * Provides layer-toggle buttons and pan/zoom navigation
 */

// Constants and globals
const SILKSCREEN_LAYER = 17;
const OUTLINE_LAYER = 28;
const PART_OUTLINES_LAYER = 29;
const PINS_LAYER = 32
const TARGET_SIZE = 1000;

class ProgressModal {
  constructor() {
    this.overlay      = document.getElementById('progressOverlay');
    this.stageElement = document.getElementById('progressStage');
    this.barElement   = document.getElementById('progressBar');
    this.pctElement   = document.getElementById('progressPercent');
    this.isVisible    = false;
  }

  show() {
    if (this.isVisible) return;
    this.isVisible = true;

    // force a reflow to restart CSS animations if you like:
    this.overlay.classList.remove('active');
    void this.overlay.offsetWidth;

    this.overlay.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  hide() {
    if (!this.isVisible) return;
    this.isVisible = false;

    this.overlay.classList.remove('active');
    document.body.style.overflow = '';
    this.updateProgress(0, 'Initializing…');
  }

  updateProgress(percent, stage = '') {
    if (!this.isVisible) return;
    const clamped = Math.max(0, Math.min(100, percent));
    this.barElement.style.width     = `${clamped}%`;
    this.pctElement.textContent     = `${Math.round(clamped)}%`;
    if (stage) this.stageElement.textContent = stage;
  }

  createProgressCallback() {
    return ({ percent, stage }) => this.updateProgress(percent, stage);
  }
}

// expose globally
window.progressModal = new ProgressModal();


let mainGroup, layerGroups = {}, labeledLayers= [SILKSCREEN_LAYER,OUTLINE_LAYER,PART_OUTLINES_LAYER,PINS_LAYER], layerColors = {}, drawableElements = [], widthScaleFactor = 0.4;

// Utility functions
const createSvgElement = (type, attrs = {}) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', type);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
};

const getLayerDisplayName = (layer, displayMap) => {
  const names = { [OUTLINE_LAYER]: 'Outlines', [SILKSCREEN_LAYER]: 'Silkscreen', [PART_OUTLINES_LAYER]: 'Part Outlines' };
  return names[layer] || (layer > 16 ? `Layer ${layer}` : `Layer ${displayMap[layer]}`);
};

const degToRad = d => d * Math.PI / 180;
const widthToBase = raw => Math.max((raw || 20000) * scale, 1);

// Path optimization for connected traces
function optimizePaths(data) {
  const elementsByLayer = new Map();

  const computeArcEndpoints = (arc) => {
    const { x1: cx, y1: cy, r, angle_start, angle_end } = arc;
    const radStart = degToRad(angle_start / 10000);
    const radEnd = degToRad(angle_end / 10000);
    return {
      p1: [Math.round(cx + r * Math.cos(radStart)), Math.round(cy + r * Math.sin(radStart))],
      p2: [Math.round(cx + r * Math.cos(radEnd)), Math.round(cy + r * Math.sin(radEnd))]
    };
  };

  // Group elements by layer
  data.main_data_block.forEach((item, index) => {
    const key = Object.keys(item)[0];
    if (key !== 'SEGMENT' && key !== 'ARC') return;

    const elem = item[key];
    if (!elementsByLayer.has(elem.layer)) elementsByLayer.set(elem.layer, []);

    const endpoints = key === 'SEGMENT'
      ? { p1: [elem.x1, elem.y1], p2: [elem.x2, elem.y2] }
      : computeArcEndpoints(elem);

    elementsByLayer.get(elem.layer).push({
      id: index, type: key.toLowerCase(), data: elem,
      p1: endpoints.p1.join(','), p2: endpoints.p2.join(','),
      p1Arr: endpoints.p1, p2Arr: endpoints.p2
    });
  });

  // Build connected paths for each layer
  const pathsByLayer = {};
  for (const [layer, elements] of elementsByLayer.entries()) {
    const elementsById = new Map(elements.map(e => [e.id, e]));
    const adj = new Map();

    // Build adjacency map
    elements.forEach(elem => {
      [elem.p1, elem.p2].forEach(point => {
        if (!adj.has(point)) adj.set(point, []);
      });
      adj.get(elem.p1).push({ neighbor: elem.p2, id: elem.id, forward: true });
      adj.get(elem.p2).push({ neighbor: elem.p1, id: elem.id, forward: false });
    });

    const used = new Set();
    const paths = [];

    // Build connected chains
    elements.forEach(startElem => {
      if (used.has(startElem.id)) return;

      const current_width = startElem.data.width ?? startElem.data.scale;
      let chain = [{ id: startElem.id, forward: true }];
      used.add(startElem.id);

      // Extend chain in both directions
      [{ start: startElem.p2, direction: 1 }, { start: startElem.p1, direction: -1 }].forEach(({ start, direction }) => {
        let current = start;
        const extensions = [];

        while (true) {
          const next = (adj.get(current) || []).find(conn => {
            const element = elementsById.get(conn.id);
            return !used.has(conn.id) && element && (element.data.width ?? element.data.scale) === current_width;
          });

          if (!next) break;
          used.add(next.id);
          extensions.push({ id: next.id, forward: direction === 1 ? next.forward : !next.forward });
          current = next.neighbor;
        }

        if (direction === -1) {
          extensions.reverse();
          chain = extensions.concat(chain);
        } else {
          chain = chain.concat(extensions);
        }
      });

      paths.push(chain.map(link => ({
        ...link,
        ...elements.find(e => e.id === link.id)
      })));
    });

    pathsByLayer[layer] = paths;
  }
  return pathsByLayer;
}

// Interactive highlighting system
function setupInteractiveHighlight(svgElement) {
  let highlightedNetId = null, isDragging = false, startPos = { x: 0, y: 0 };
  const dragThreshold = 10;

  const highlightNet = (netId) => {
    if (netId === highlightedNetId) return;
    clearHighlight();
    highlightedNetId = netId;
    svgElement.querySelectorAll(`[data-net_index="${netId}"]`).forEach(el => el.classList.add('highlight'));
  };

  const clearHighlight = () => {
    if (highlightedNetId) {
      svgElement.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));
      highlightedNetId = null;
    }
  };

  const handlers = {
    down: (x, y) => { isDragging = false; startPos = { x, y }; },
    move: (x, y) => {
      if (startPos.x && Math.hypot(x - startPos.x, y - startPos.y) > dragThreshold) isDragging = true;
    },
    up: (event) => {
      if (!isDragging) {
        const target = event.target;
        const isNetElement = ['circle', 'line', 'path', 'polygon', 'rect'].includes(target.tagName) && target.dataset.net_index;
        const isBackground = !target.classList.contains('svg-pan-zoom-control') &&
          !target.classList.contains('svg-pan-zoom-background') &&
          !target.classList.contains('svg-pan-zoom-control-element');

        if (isNetElement) highlightNet(target.dataset.net_index);
        else if (isBackground) clearHighlight();
      }
      startPos = { x: 0, y: 0 };
    }
  };

  // Attach unified event handlers
  ['mousedown', 'touchstart'].forEach(event =>
    svgElement.addEventListener(event, e => {
      const touch = e.touches?.[0] || e;
      handlers.down(touch.clientX, touch.clientY);
    }, { passive: true })
  );

  svgElement.addEventListener('mousemove', e => {
    if (e.buttons === 1) handlers.move(e.clientX, e.clientY);
  });

  svgElement.addEventListener('touchmove', e =>
    handlers.move(e.touches[0].clientX, e.touches[0].clientY), { passive: true }
  );

  ['mouseup', 'touchend'].forEach(event => svgElement.addEventListener(event, handlers.up));
}

// Optimized pin rendering (no transforms, direct shapes)
function createOptimizedPin(pin, x, y, scale) {
  if (!pin.width){
    pin.width = pin.outline[0].outline_x;
    pin.height = pin.outline[0].outline_y;
  }
  let width = (pin.width * scale) || 10000;
  let height = (pin.height * scale) || 10000;
  const rotation = -((pin.rotation / 10000 || 0));

  if ((rotation % 180) !== 0 && (rotation % 90) === 0) [width, height] = [height, width];

  const pinElements = [];
  const commonAttrs = { class: pin.shape === 2 ? 'pin-rect' : pin.shape === 1 ? 'pin-circle' : 'pin-rounded-rect', 'data-net_index': pin.net_index };

  if (pin.shape === 2 || pin.outline?.[0].outline_type === 2) { // Rectangular
    if (rotation % 90 === 0) {
      pinElements.push(createSvgElement('rect', {
        ...commonAttrs, width, height, x: x - width / 2, y: y - height / 2
      }));
    } else {
      // Rotated rectangle as polygon
      const corners = [[-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2]];
      const rotRad = degToRad(rotation % 90);
      const points = corners.map(([cx, cy]) => {
        const rx = cx * Math.cos(rotRad) - cy * Math.sin(rotRad) + x;
        const ry = cx * Math.sin(rotRad) + cy * Math.cos(rotRad) + y;
        return `${rx},${ry}`;
      }).join(' ');
      pinElements.push(createSvgElement('polygon', { ...commonAttrs, points }));
    }
  } else if (pin.shape === 1 || pin.outline?.[0].outline_type === 1) { // Round/Oval
    if (pin.width === pin.height) {
      pinElements.push(createSvgElement('circle', {
        ...commonAttrs, cx: x, cy: y, r: Math.min(width, height) / 2
      }));
    } else {
      const radius = Math.min(width, height) / 2;
      pinElements.push(createSvgElement('rect', {
        ...commonAttrs, width, height, x: x - width / 2, y: y - height / 2, rx: radius, ry: radius
      }));
    }
  }

  // Add hole if present
  if (pin.inner_diameter !== 0) {
    pinElements.push(createSvgElement('circle', {
      class: 'pin-hole', cx: x, cy: y, r: Math.min((pin.inner_diameter / 2) * scale, 20)
    }));
  }

  return pinElements;
}

// Main rendering function
async function renderSegments(json) {
  // Add small delays for progress updates
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const raw = json?.main_data_block || [];
  const segments = raw.filter(d => d.SEGMENT).map(d => d.SEGMENT);
  const arcs = raw.filter(d => d.ARC).map(d => d.ARC);
  const vias = raw.filter(d => d.VIA).map(d => d.VIA);

  const controls = document.getElementById('controls');
  const svg = document.getElementById('pcb');

  if (!segments.length && !arcs.length && !vias.length) {
    controls.textContent = 'No drawable objects found in file.';
    return;
  }

  // Progress updates during rendering
  if (progressModal.isVisible) {
      progressModal.updateProgress(60, 'Setting up SVG structure...');
      await delay(50);
  }


  // Setup and clear
  setupInteractiveHighlight(svg);
  svg.innerHTML = '';
  drawableElements = [];

  // Create main structure
  const viewport = createSvgElement('g', { id: "viewport" });
  mainGroup = createSvgElement('g', { id: "mainGroup" });
  const layerContainer = createSvgElement('g');
  viewport.appendChild(mainGroup);
  mainGroup.appendChild(layerContainer);
  svg.appendChild(viewport);

  // Compute bounds and scaling
  const allObjects = [...segments, ...arcs, ...vias];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  segments.forEach(s => {
    [minX, maxX] = [Math.min(minX, s.x1, s.x2), Math.max(maxX, s.x1, s.x2)];
    [minY, maxY] = [Math.min(minY, s.y1, s.y2), Math.max(maxY, s.y1, s.y2)];
  });
  arcs.forEach(a => {
    [minX, maxX] = [Math.min(minX, a.x1 - a.r), Math.max(maxX, a.x1 + a.r)];
    [minY, maxY] = [Math.min(minY, a.y1 - a.r), Math.max(maxY, a.y1 + a.r)];
  });
  vias.forEach(v => {
    if (!v.outer_radius)
      {
        v.outer_radius = Math.max(v.layer_a_radius,v.layer_b_radius);
        v.inner_radius = Math.min(v.layer_a_radius,v.layer_b_radius);
      }
      
    [minX, maxX] = [Math.min(minX, v.x - v.outer_radius), Math.max(maxX, v.x + v.outer_radius)];
    [minY, maxY] = [Math.min(minY, v.y - v.outer_radius), Math.max(maxY, v.y + v.outer_radius)];
  });

  const rawWidth = maxX - minX, rawHeight = maxY - minY;
  const centerX = minX + rawWidth / 2, centerY = minY + rawHeight / 2;

  window.scale = rawWidth >= rawHeight ? TARGET_SIZE / rawWidth : TARGET_SIZE / rawHeight;
  const normWidth = rawWidth * scale, normHeight = rawHeight * scale;

  const mapX = x => (x - centerX) * scale;
  const mapY = y => (centerY - y) * scale;

  svg.setAttribute('viewBox', `-${normWidth / 2} -${normHeight / 2} ${normWidth} ${normHeight}`);

  // Setup layers and colors
  const style = getComputedStyle(document.documentElement);
  const SILKSCREEN_COLOR = style.getPropertyValue('--silkscreen').trim();
  const OUTLINE_COLOR = style.getPropertyValue('--outline').trim();
  const layers = [...new Set([...segments.map(s => s.layer), ...arcs.map(a => a.layer),
  ...vias.flatMap(v => [v.layer_a_index, v.layer_b_index]), PART_OUTLINES_LAYER])].sort((a, b) => a - b);

  const populatedLayers = [...new Set([...segments.map(s => s.layer), ...arcs.map(a => a.layer)])]
    .filter(l => l !== OUTLINE_LAYER && l !== SILKSCREEN_LAYER && l <= 16).sort((a, b) => a - b);
  const displayMap = Object.fromEntries(populatedLayers.map((l, i) => [l, i + 1]));

  const defaultVisible = new Set([populatedLayers[0] ?? 1, populatedLayers[populatedLayers.length - 1] ?? 16,
    OUTLINE_LAYER, SILKSCREEN_LAYER, PART_OUTLINES_LAYER, PINS_LAYER]);

  layers.forEach((layer, idx) => {
    layerGroups[layer] = createSvgElement('g', {'data-layer':layer});
    layerContainer.appendChild(layerGroups[layer]);

    const colorMap = { [OUTLINE_LAYER]: OUTLINE_COLOR, [SILKSCREEN_LAYER]: SILKSCREEN_COLOR, [PART_OUTLINES_LAYER]: '#FF6B35' };
    layerColors[layer] = colorMap[layer] || style.getPropertyValue(`--layer-${idx % 13}`).trim();
    // layerGroups[layer].setAttribute('display', defaultVisible.has(layer) ? 'inline' : 'none');
  });

    if (progressModal.isVisible) {
        progressModal.updateProgress(65, 'Optimizing paths...');
        await delay(50);
    }
  
  // Render optimized paths
  const optimized = optimizePaths(json);

  if (progressModal.isVisible) {
    progressModal.updateProgress(70, 'Generating optimized path elements...');
    await delay(50);
  }
  for (const [layerStr, paths] of Object.entries(optimized)) {
    const layer = Number(layerStr);
    if (!layerGroups[layer]) continue;

    paths.forEach(pathChain => {
      if (!pathChain.length) return;

      let d = '';
      const firstLink = pathChain[0];
      const startP = firstLink.forward ? firstLink.p1Arr : firstLink.p2Arr;
      d += `M ${mapX(startP[0])} ${mapY(startP[1])}`;

      pathChain.forEach(link => {
        const toP = link.forward ? link.p2Arr : link.p1Arr;
        const [tx, ty] = [mapX(toP[0]), mapY(toP[1])];

        if (link.type === 'segment') {
          d += ` L ${tx} ${ty}`;
        } else {
          const a = link.data;
          const rScaled = a.r * scale;
          const [angleStart, angleEnd] = link.forward ? [a.angle_start, a.angle_end] : [a.angle_end, a.angle_start];
          const [radStart, radEnd] = [angleStart, angleEnd].map(angle => degToRad(angle / 10000));

          let delta = (radEnd - radStart) % (2 * Math.PI);
          if (delta > Math.PI) delta -= 2 * Math.PI;
          if (delta < -Math.PI) delta += 2 * Math.PI;

          const [largeArcFlag, sweepFlag] = [delta > Math.PI ? 1 : 0, delta > 0 ? 0 : 1];
          d += ` A ${rScaled} ${rScaled} 0 ${largeArcFlag} ${sweepFlag} ${tx} ${ty}`;
        }
      });

      if (d) {
        const elem = pathChain[0].data;
        const baseWidth = widthToBase(elem.width ?? elem.scale);
        const pathEl = createSvgElement('path', {
          d, fill: 'none', stroke: layerColors[layer] || 'black',
          'stroke-width': baseWidth * widthScaleFactor, 'stroke-linecap': 'round'
        });
        pathEl.dataset.net_index = elem.net_index;
        pathEl.dataset.baseWidth = baseWidth;
        drawableElements.push(pathEl);
        layerGroups[layer].appendChild(pathEl);
      }
    });
  }
  if (progressModal.isVisible) {
    progressModal.updateProgress(80, 'Building via structures...');
    await delay(50);
}
  // Render vias
  const viaOverlay = createSvgElement('g');
  const viaElements = [], viaTextElements = [];
  let showViaNumbers = true;

  vias.forEach(v => {
    const [cx, cy, rOuter, rInner] = [mapX(v.x), mapY(v.y), v.outer_radius * scale, v.inner_radius * scale];
    const gVia = createSvgElement('g');

    gVia.appendChild(createSvgElement('circle', {
      cx, cy, r: rOuter, fill: 'white', 'fill-opacity': 0.4, stroke: 'none'
    })).dataset.net_index = v.net_index;

    [{ side: -1, layer: v.layer_a_index }, { side: 1, layer: v.layer_b_index }].forEach(({ side, layer }) => {
      const color = layerColors[layer] || '#888';
      const label = displayMap[layer] ?? layer;

      gVia.appendChild(createSvgElement('path', {
        d: `M ${cx} ${cy - rInner} A ${rInner} ${rInner} 0 0 ${side === 1 ? 1 : 0} ${cx} ${cy + rInner} L ${cx} ${cy} Z`,
        fill: color, stroke: 'none', 'pointer-events': 'none'
      }));

      const text = createSvgElement('text', {
        x: cx + (side * rInner) / 2, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-size': rInner * 0.6, fill: 'white', 'pointer-events': 'none'
      });
      text.textContent = label;
      gVia.appendChild(text);
      viaTextElements.push(text);
    });

    gVia.dataset.startL = Math.min(v.layer_a_index, v.layer_b_index);
    gVia.dataset.endL = Math.max(v.layer_a_index, v.layer_b_index);
    viaOverlay.appendChild(gVia);
    viaElements.push(gVia);
  });
  mainGroup.appendChild(viaOverlay);
  
  //Progress Report
  if (progressModal.isVisible) {
    progressModal.updateProgress(85, 'Constructing component groups...');
    await delay(50);
  }
  // Render components (Type07 data)
  const type07Overlay = createSvgElement('g');
  const type07Blocks = raw.filter(block => block.DATA?.parsed_data || block.DATA);

  type07Blocks.forEach(block => {
    const parsedData = block.DATA.parsed_data || block.DATA;
    if (!parsedData?.sub_blocks && parsedData.subtype09 ) {
      let subBlocks = [];
      parsedData.subtype05.forEach(t=>{
        t.type="sub_type_05";
        subBlocks.push(t);
      });
      parsedData.subtype06.forEach(t=>{
        t.type="sub_type_06";
        subBlocks.push(t);
      });
      let type09Group = {
        type:'sub_type_09',
        pins: []
      }
      parsedData.subtype09.forEach(t=>{
        type09Group.pins.push(t);
      });
      subBlocks.push(type09Group);
      parsedData.sub_blocks = subBlocks;
    } else if (!parsedData?.sub_blocks && !parsedData.subtype09)
      return;
    let partName = "";
    const partGroup = createSvgElement('g', { class: 'part' }),outlineGroup = createSvgElement('g', { class: 'outlines', 'data-layer':PART_OUTLINES_LAYER }), pinsGroup = createSvgElement('g', { class: 'pins', 'data-layer': PINS_LAYER });
    parsedData.sub_blocks.forEach(subBlock => {
      if (subBlock.type === 'sub_type_05') {
        // Part outlines
        const baseWidth = Math.max((subBlock.scale || 20000) * scale * 0.3, 0.5);
        const line = createSvgElement('line', {
          x1: mapX(subBlock.x1), y1: mapY(subBlock.y1),
          x2: mapX(subBlock.x2), y2: mapY(subBlock.y2),
          'stroke-width': baseWidth * widthScaleFactor,
          'data-layer':PART_OUTLINES_LAYER, 'data-base-width': baseWidth
        });
        line.style.setProperty('--base-width', baseWidth);
        line.style.setProperty('--width-scale-factor', widthScaleFactor);
        // layerGroups[PART_OUTLINES_LAYER].appendChild(line); //Instead of adding this to a layer group, we'll consolidate part elements into one group (outlines, pins, text?) and use classes to toggle visibility. (Instead of adding and removing classes from thousands of elements, add the appropriate classes once, target with css, and edit the rule with JS on button press.)
        outlineGroup.appendChild(line);
        drawableElements.push(line);
      } else if (subBlock.type === 'sub_type_06' && (subBlock.label || subBlock.type_06_label)) {
        partName = subBlock.label || subBlock.type_06_label;
      } else if (subBlock.type === 'sub_type_09') {
        // Pins
        subBlock.pins.forEach(pin => {
          const pinGroup = createSvgElement('g', { id: `${partName}-${pin.name}` });
          const pinElements = createOptimizedPin(pin, mapX(pin.x), mapY(pin.y), scale);
          pinElements.forEach(el => pinGroup.appendChild(el));
          pinsGroup.appendChild(pinGroup);
        });
      }
    });
    partGroup.appendChild(outlineGroup);
    partGroup.appendChild(pinsGroup);
    if (partName) {
      partGroup.id = partName;
      const typeMap = { C: "Capacitor", R: "Resistor", J: "Connector", U: "Chip", L: "Inductor" };
      partGroup.classList.add(typeMap[partName[0]] || "Unknown");
    }
    type07Overlay.appendChild(partGroup);
  });
  mainGroup.appendChild(type07Overlay);
  const controlWrapper = document.getElementById('control-wrap');

  // UI Controls
  /**
   * Updates via visibility based on the master list of active layers.
   * @param {Set<string>} activeLayersSet - The Set containing all visible layer IDs.
   */
  const updateViaVisibility = (activeLayersSet) => {
    // Assuming 'viaElements' is an array or NodeList of your via SVG elements
    viaElements.forEach(el => {
      // Get the start and end layers for this specific via
      const startL = el.dataset.startL;
      const endL = el.dataset.endL;
  
      // The core logic: is the start OR the end layer in the active Set?
      const isVisible = activeLayersSet.has(parseInt(startL)) || activeLayersSet.has(parseInt(endL));
  
      // Set the display attribute accordingly
      el.setAttribute('display', isVisible ? 'inline' : 'none');
    });
  };
  
  const updateViaNumberVisibility = () => {
    viaTextElements.forEach(text => text.setAttribute('display', showViaNumbers ? 'inline' : 'none'));
  };
  controlWrapper.classList.replace('panel-center', 'panel-left');
  if (progressModal.isVisible) {
    progressModal.updateProgress(95, 'Instantiating UI!');
  }
  // Build controls
  controls.innerHTML = '';

  // Width slider
  const sliderLabel = document.createElement('span');
  sliderLabel.textContent = 'Width ×0.4';
  const widthSlider = Object.assign(document.createElement('input'), {
    type: 'range', min: '0.1', max: '5', step: '0.1', value: '0.4',
    oninput: () => {
      widthScaleFactor = parseFloat(widthSlider.value);
      sliderLabel.textContent = `Width ×${widthScaleFactor.toFixed(1)}`;
      drawableElements.forEach(el => el.setAttribute('stroke-width', el.dataset.baseWidth * widthScaleFactor));
    }
  });
  controls.append(sliderLabel, widthSlider, document.createElement('br'));

  const activeLayers = new Set();
  defaultVisible.forEach(l=> {
    activeLayers.add(l);
  });
  function updateDOM() {
    // Example: new Set([0, 5, 12]) becomes "0 5 12"
    const activeLayersString = [...activeLayers].join(' ');
    controlWrapper.dataset.activeLayers = activeLayersString;
  }
  
  function toggleActive(button, num){
    if (activeLayers.has(num)) {
      activeLayers.delete(num);
      button.classList.remove('active');
    } else {
      activeLayers.add(num);
      button.classList.add('active');
    }
  }
  // Toggle buttons
  const createToggleButton = (text, initialState, onClick) => {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.classList.toggle('active', initialState);
    btn.onclick = onClick;
    return btn;
  };

  controls.appendChild(createToggleButton('Via Numbers', true, function () {
    showViaNumbers = !showViaNumbers;
    this.classList.toggle('active', showViaNumbers);
    updateViaNumberVisibility();
  }));

  controls.appendChild(document.createElement('br'));



  const pinsBtn = createToggleButton('Pin Rendering', true, function () {
    const visible = this.classList.contains('active');
    this.dataset.layer = PINS_LAYER;
    // type07Overlay.setAttribute('display', visible ? 'none' : 'inline');
    toggleActive(this,PINS_LAYER);
    updateDOM();
  });
  pinsBtn.setAttribute('data-layer',PINS_LAYER)
  controls.appendChild(pinsBtn);
  controls.appendChild(document.createElement('br'));

  // Layer buttons
  const layerButtons = {};
  const showAllBtn = createToggleButton('Show All', false, () => {
    
    labeledLayers.forEach(layer=>{
      if (!activeLayers.has(layer)) activeLayers.add(layer);
    });
    layers.forEach(layer => {
      if (!activeLayers.has(layer)) activeLayers.add(layer);
      layerButtons[layer]?.classList.toggle('active',true);
    });
    updateDOM();
    updateViaVisibility(activeLayers);
  });
  controls.appendChild(showAllBtn);

  layers.forEach(layer => {
    if (layer !== OUTLINE_LAYER && layer !== SILKSCREEN_LAYER && !displayMap[layer] && layer <= 16) return;
    
    const btn = createToggleButton(getLayerDisplayName(layer, displayMap), defaultVisible.has(layer), function () {
    
      // Toggle the layer's presence in the Set
      toggleActive(this, layer);
  
      // Update the DOM for single-layer elements via CSS
      updateDOM();
  
      // Update the vias via JavaScript using the master Set
      updateViaVisibility(activeLayers);
    });
    btn.setAttribute('data-layer', layer);
    btn.style.setProperty('--layer-color', layerColors[layer]);
    controls.appendChild(btn);
    layerButtons[layer] = btn;
  });
  //Make sure we set the initial values for visible layers
  updateDOM();

  // Initialize
  updateViaVisibility(activeLayers);
  updateViaNumberVisibility();

  // Setup navigation
  let navControls =document.getElementById("navControls");
  if (window.pcbNavigator) window.pcbNavigator.reset();
  window.pcbNavigator = new SvgNavigator(svg, viewport);
  addControls(navControls, window.pcbNavigator);
  navControls.setAttribute("data-active", "true");
  mainGroup.style.transformOrigin = '0 0';

}
// Initialize progress modal
const progressModal = new ProgressModal();

// Replace the existing fetch section with this optimized version:
async function loadPCBFile() {
    try {
        progressModal.show();
        
        const response = await fetch('switch2.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        progressModal.updateProgress(10, 'Loading file...');
        const data = await response.json();
        
        progressModal.updateProgress(20, 'Initializing renderer...');
        await renderSegments(data);
        
    } catch (err) {
        console.warn('Automatic fetch failed:', err);
        handleFileInputFallback();
    } finally {
        progressModal.hide();
    }
}

function handleFileInputFallback(){
  const controls = document.getElementById('controls');
  controls.innerHTML = '';

  const info = document.createElement('span');
  info.textContent = 'Select a JSON or PCB file: ';
  controls.appendChild(info);

  const input = Object.assign(document.createElement('input'), {
    type: 'file',
    accept: '.pcb,.json,application/json',
    onchange: () => {
      const file = input.files[0];
      handleFileInput(file);
    }
  });
  controls.appendChild(input);

  const hint = document.createElement('div');
  Object.assign(hint.style, { fontSize: '0.75rem', marginTop: '4px' });
  hint.textContent = 'Input file can be a JSON file exported from ImHex using the XZZPCB pattern file, or a raw .pcb file';
  controls.appendChild(hint);
}

// Update file input handler for .pcb files:
function handleFileInput(file) {
    if (!file) return;
    
    const reader = new FileReader();
    const isPCB = file.name.toLowerCase().endsWith('.pcb');
    
    progressModal.show();
    
    reader.onload = async (e) => {
        try {
            let data;
            
            if (isPCB) {
                // Use optimized parser with progress callback
                const progressCallback = progressModal.createProgressCallback();
                const parser = new RawPCBParser(progressCallback);
                data = parser.parse(e.target.result);
            } else {
                progressModal.updateProgress(30, 'Parsing JSON...');
                data = JSON.parse(e.target.result);
            }
            
            progressModal.updateProgress(55, 'Rendering PCB...');
            await renderSegments(data);
            
        } catch (error) {
            const controls = document.getElementById('controls');
            controls.textContent = `Invalid ${isPCB ? 'PCB' : 'JSON'} file.`;
            console.error('Parsing error:', error);
        } finally {
            progressModal.hide();
        }
    };
    
    isPCB ? reader.readAsArrayBuffer(file) : reader.readAsText(file);
}
// File loading
loadPCBFile();