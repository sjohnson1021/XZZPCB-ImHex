/* render_layers.js
 * Loads PCB SEGMENT data from switch2_example.json (or user-selected JSON) and renders it
 * with SVG. Provides layer-toggle buttons and pan/zoom using svg-pan-zoom.
 */

// Helper to create SVG elements with attributes
function createSvgElement(type, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', type);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

// Helper function to get the display name for a layer
function getLayerDisplayName(layer, displayMap, OUTLINE_LAYER, SILKSCREEN_LAYER, PART_OUTLINES_LAYER) {
  if (layer === OUTLINE_LAYER) {
    return 'Outlines';
  } else if (layer === SILKSCREEN_LAYER) {
    return 'Silkscreen';
  } else if (layer === PART_OUTLINES_LAYER) {
    return 'Part Outlines';
  } else if (layer > 16) {
    return `Layer ${layer}`;
  } else {
    return `Layer ${displayMap[layer]}`;
  }
}

// Render function encapsulates all drawing logic so we can call it from different loaders
function renderSegments(json) {
  // Define layer constants first
  const SILKSCREEN_LAYER = 17;
  const OUTLINE_LAYER = 28;
  const PART_OUTLINES_LAYER = 29; // New layer for part outlines

  const raw = json?.main_data_block || [];
  const segments = [];
  const arcs = [];
  const vias = [];
  raw.forEach(d => {
    if (d.SEGMENT) segments.push(d.SEGMENT);
    if (d.ARC) arcs.push(d.ARC);
    if (d.VIA) vias.push(d.VIA);
  });

  const controls = document.getElementById('controls');
  const svg = document.getElementById('pcb');

  if (!segments.length && !arcs.length && !vias.length) {
    controls.textContent = 'No drawable objects found in file.';
    return;
  }

  // Clear any previous render
  svg.innerHTML = '';

  // Compute overall bounds
  const layers = [...new Set([
    ...segments.map(o => o.layer),
    ...arcs.map(o => o.layer),
    ...vias.flatMap(v => [v.layer_a_index, v.layer_b_index]),
    PART_OUTLINES_LAYER // Ensure part outlines layer is included
  ])].sort((a, b) => a - b);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  segments.forEach(s => {
    minX = Math.min(minX, s.x1, s.x2);
    minY = Math.min(minY, s.y1, s.y2);
    maxX = Math.max(maxX, s.x1, s.x2);
    maxY = Math.max(maxY, s.y1, s.y2);
  });
  arcs.forEach(a => {
    minX = Math.min(minX, a.x1 - a.r, a.x1 + a.r);
    minY = Math.min(minY, a.y1 - a.r, a.y1 + a.r);
    maxX = Math.max(maxX, a.x1 - a.r, a.x1 + a.r);
    maxY = Math.max(maxY, a.y1 - a.r, a.y1 + a.r);
  });
  vias.forEach(v => {
    minX = Math.min(minX, v.x - v.outer_radius, v.x + v.outer_radius);
    minY = Math.min(minY, v.y - v.outer_radius, v.y + v.outer_radius);
    maxX = Math.max(maxX, v.x - v.outer_radius, v.x + v.outer_radius);
    maxY = Math.max(maxY, v.y - v.outer_radius, v.y + v.outer_radius);
  });
  // Normalise coordinates to a manageable SVG viewport
  const mapY = yRaw => (maxY - yRaw) * scale;
  const rawWidth = maxX - minX;
  const rawHeight = maxY - minY;
  const TARGET_SIZE = 1000; // Base dimension in SVG units
  let scale, normWidth, normHeight;
  if (rawWidth >= rawHeight) {
    scale = TARGET_SIZE / rawWidth;
    normWidth = TARGET_SIZE;
    normHeight = rawHeight * scale;
  } else {
    scale = TARGET_SIZE / rawHeight;
    normHeight = TARGET_SIZE;
    normWidth = rawWidth * scale;
  }
  svg.setAttribute('viewBox', `0 0 ${normWidth} ${normHeight}`);

  const layerGroups = {};
  const layerColors = {};
  
  // Get CSS custom properties
  const style = getComputedStyle(document.documentElement);
  const SILKSCREEN_COLOR = style.getPropertyValue('--silkscreen').trim();
  const OUTLINE_COLOR = style.getPropertyValue('--outline').trim();
  
  const getLayerColor = (index) => {
    return style.getPropertyValue(`--layer-${index % 13}`).trim();
  };
  // Build populated layer mapping (segments/arcs only)
  const populatedLayers = [...new Set([...segments.map(s=>s.layer), ...arcs.map(a=>a.layer)])]
    .filter(l => l !== OUTLINE_LAYER && l !== SILKSCREEN_LAYER && l <= 16)
    .sort((a,b)=>a-b);
  const displayMap = {};
  populatedLayers.forEach((l,i)=> displayMap[l]=i+1);

  const defaultVisible = new Set([populatedLayers[0] ?? 1, populatedLayers[populatedLayers.length-1] ?? 16, OUTLINE_LAYER, SILKSCREEN_LAYER, PART_OUTLINES_LAYER]);
  layers.forEach((layer, idx) => {
    layerGroups[layer] = createSvgElement('g');
    svg.appendChild(layerGroups[layer]);
    layerColors[layer] = layer === OUTLINE_LAYER ? OUTLINE_COLOR : layer === SILKSCREEN_LAYER ? SILKSCREEN_COLOR : layer === PART_OUTLINES_LAYER ? '#FF6B35' : getLayerColor(idx);
    layerGroups[layer].setAttribute('display', defaultVisible.has(layer) ? 'inline' : 'none');
  });

  // Helper to convert raw width units to normalised stroke width
  const widthToBase = raw => Math.max((raw || 20000) * scale, 1);

  let widthScaleFactor = 0.4;
  const drawableElements = []; // store all elements with base width for slider scaling

  // Draw all line segments
  segments.forEach(s => {
    const baseWidth = widthToBase(s.width ?? s.scale);
    const line = createSvgElement('line', {
      x1: (s.x1 - minX) * scale,
      y1: mapY(s.y1),
      x2: (s.x2 - minX) * scale,
      y2: mapY(s.y2),
      stroke: layerColors[s.layer] || 'black',
      'stroke-width': baseWidth * widthScaleFactor,
      'stroke-linecap': 'round',
    });
    line.dataset.baseWidth = baseWidth;
    drawableElements.push(line);
    layerGroups[s.layer].appendChild(line);
  });

  // Draw vias
  // --- VIA rendering (single overlay, then visibility synced)
  const viaOverlay = createSvgElement('g');
  svg.appendChild(viaOverlay);
  const viaElements = [];
  const viaTextElements = []; // Store text elements separately for toggling
  let showViaNumbers = true; // Toggle for via numbers visibility

  vias.forEach(v => {
    const cx = (v.x - minX) * scale;
    const cy = mapY(v.y);
    const rOuter = v.outer_radius * scale;
    const rInner = v.inner_radius * scale;

    const gVia = createSvgElement('g');

    // Outer translucent circle
    const outerC = createSvgElement('circle', {
      cx,
      cy,
      r: rOuter,
      fill: 'white',
      'fill-opacity': 0.4,
      stroke: 'none',
    });
    gVia.appendChild(outerC);

    // Helper to build half-circle path (side -1 for left, +1 for right)
    const buildHalf = (side, color, label) => {
      const path = createSvgElement('path', {
        d: `M ${cx} ${cy - rInner} A ${rInner} ${rInner} 0 0 ${side === 1 ? 1 : 0} ${cx} ${cy + rInner} L ${cx} ${cy} Z`,
        fill: color,
        stroke: 'none',
      });
      const text = createSvgElement('text', {
        x: cx + (side * rInner) / 2,
        y: cy,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        'font-size': rInner * 0.6,
        fill: 'white',
        'pointer-events': 'none',
      });
      text.textContent = label;
      gVia.appendChild(path);
      gVia.appendChild(text);
      viaTextElements.push(text); // Store text element for toggling
    };

    const layerACol = layerColors[v.layer_a_index] || '#888';
    const layerBCol = layerColors[v.layer_b_index] || '#888';

    buildHalf(-1, layerACol, displayMap[v.layer_a_index] ?? v.layer_a_index);
    buildHalf(1, layerBCol, displayMap[v.layer_b_index] ?? v.layer_b_index);

    // store layers it belongs to for visibility calc
    const startL = Math.min(v.layer_a_index, v.layer_b_index);
    const endL = Math.max(v.layer_a_index, v.layer_b_index);
    gVia.dataset.startL = startL;
    gVia.dataset.endL = endL;
    viaOverlay.appendChild(gVia);
    viaElements.push(gVia);
  });

  const updateViaVisibility = () => {
    // gather all currently visible physical layers
    const visibleLayers = Object.keys(layerGroups).filter(L => layerGroups[L].getAttribute('display') !== 'none').map(Number);
    viaElements.forEach(el => {
      const startL = Number(el.dataset.startL);
      const endL = Number(el.dataset.endL);
      const visible = visibleLayers.some(L => L >= startL && L <= endL);
      el.setAttribute('display', visible ? 'inline' : 'none');
    });
  };

  const updateViaNumberVisibility = () => {
    viaTextElements.forEach(text => {
      text.setAttribute('display', showViaNumbers ? 'inline' : 'none');
    });
  };

  // Render Type07 parsed data (sub_type_05 and sub_type_09)
  const type07Elements = [];
  const type07Overlay = createSvgElement('g');
  svg.appendChild(type07Overlay);

  // Process type07 blocks from the parsed data
  const type07Blocks = raw.filter(block => block.DATA && block.DATA.parsed_data);
  
  type07Blocks.forEach((block, blockIndex) => {
    const parsedData = block.DATA.parsed_data;
    if (!parsedData || !parsedData.sub_blocks) return;

    parsedData.sub_blocks.forEach((subBlock, subIndex) => {
      if (subBlock.type === 'sub_type_05') {
        // Render line segments as lines on the part outlines layer
        const x1 = (subBlock.x1 - minX) * scale;
        const y1 = mapY(subBlock.y1);
        const x2 = (subBlock.x2 - minX) * scale;
        const y2 = mapY(subBlock.y2);
        
        // Calculate line width with reduced scale for thinner lines
        const baseWidth = Math.max((subBlock.scale || 20000) * scale * 0.3, 0.5);
        
        const line = createSvgElement('line', {
          x1: x1,
          y1: y1,
          x2: x2,
          y2: y2,
          stroke: '#FF6B35',
          'stroke-width': baseWidth * widthScaleFactor,
          'stroke-linecap': 'round',
          'stroke-opacity': 1.0,
        });
        line.dataset.baseWidth = baseWidth;
        layerGroups[PART_OUTLINES_LAYER].appendChild(line);
        drawableElements.push(line);
        type07Elements.push(line);

      } else if (subBlock.type === 'sub_type_09') {
        // Render pins as circles at their coordinates
        const x = (subBlock.x - minX) * scale;
        const y = mapY(subBlock.y);
        
        // Use average of width and height for circle size with better bounds checking
        const width = subBlock.width || 10000;
        const height = subBlock.height || 10000;
        const pinSize = Math.min(width,height)/2;
        const radius = Math.max(Math.min(pinSize * scale, 20), 0.1); // Clamp between 0.001 and 1
        
        const pinCircle = createSvgElement('circle', {
          cx: x,
          cy: y,
          r: radius,
          fill: 'white',
          'fill-opacity': 0.6,
        });
        type07Overlay.appendChild(pinCircle);
        type07Elements.push(pinCircle);
      }
    });
  });

  // Draw arcs
  const degToRad = d => (d / 10000) * (Math.PI / 180);
  arcs.forEach(a => {
    const baseWidth = widthToBase(a.width ?? a.scale);
    const rScaled = a.r * scale;
    const startRad = degToRad(a.angle_start);
    const endRad = degToRad(a.angle_end);

    const startX = (a.x1 + a.r * Math.cos(startRad) - minX) * scale;
    const startY = mapY(a.y1 + a.r * Math.sin(startRad));
    const endX = (a.x1 + a.r * Math.cos(endRad) - minX) * scale;
    const endY = mapY(a.y1 + a.r * Math.sin(endRad));

    let delta = (endRad - startRad) % (2 * Math.PI);
    if (delta < 0) delta += 2 * Math.PI;
    const largeArcFlag = delta > Math.PI ? 1 : 0;
    const sweepFlag = delta > 0 ? 0 : 1; // Inverted for flipped Y coordinate system

    const path = createSvgElement('path', {
      d: `M ${startX} ${startY} A ${rScaled} ${rScaled} 0 ${largeArcFlag} ${sweepFlag} ${endX} ${endY}`,
      fill: 'none',
      stroke: layerColors[a.layer] || 'black',
      'stroke-width': baseWidth * widthScaleFactor,
      'stroke-linecap': 'round',
    });
    path.dataset.baseWidth = baseWidth;
    drawableElements.push(path);
    layerGroups[a.layer].appendChild(path);
  });

  // Build layer toggle buttons + master "Show All"
  controls.innerHTML = '';

  // Width scale slider
  const sliderLabel = document.createElement('span');
  sliderLabel.style.marginRight = '4px';
  sliderLabel.textContent = 'Width ×0.4';

  const widthSlider = document.createElement('input');
  widthSlider.type = 'range';
  widthSlider.min = '0.1';
  widthSlider.max = '5';
  widthSlider.step = '0.1';
  widthSlider.value = '0.4';
  widthSlider.style.verticalAlign = 'middle';
  widthSlider.oninput = () => {
    widthScaleFactor = parseFloat(widthSlider.value);
    sliderLabel.textContent = `Width ×${widthScaleFactor.toFixed(1)}`;
    drawableElements.forEach(el => {
      el.setAttribute('stroke-width', el.dataset.baseWidth * widthScaleFactor);
    });
  };
  controls.appendChild(sliderLabel);
  controls.appendChild(widthSlider);
  controls.appendChild(document.createElement('br'));

  // Via numbers toggle
  const viaNumbersBtn = document.createElement('button');
  viaNumbersBtn.textContent = 'Via Numbers';
  viaNumbersBtn.classList.add('active'); // Start as active (numbers visible)
  viaNumbersBtn.onclick = () => {
    showViaNumbers = !showViaNumbers;
    viaNumbersBtn.classList.toggle('active', showViaNumbers);
    updateViaNumberVisibility();
  };
  controls.appendChild(viaNumbersBtn);
  controls.appendChild(document.createElement('br'));

  // Type07 overlay toggle
  const type07Btn = document.createElement('button');
  type07Btn.textContent = 'Pin Rendering';
  type07Btn.classList.add('active'); // Start as active (overlay visible)
  type07Btn.onclick = () => {
    const visible = type07Overlay.getAttribute('display') !== 'none';
    type07Overlay.setAttribute('display', visible ? 'none' : 'inline');
    type07Btn.classList.toggle('active', !visible);
  };
  controls.appendChild(type07Btn);
  controls.appendChild(document.createElement('br'));

  const layerButtons = {};

  // Master button
  const showAllBtn = document.createElement('button');
  showAllBtn.textContent = 'Show All';
  showAllBtn.onclick = () => {
    layers.forEach(layer => {
      layerGroups[layer].setAttribute('display', 'inline');
      if (layerButtons[layer]) layerButtons[layer].classList.add('active');
    });
    updateViaVisibility();
    // Show type07 overlay
    type07Overlay.setAttribute('display', 'inline');
    type07Btn.classList.add('active');
  };
  controls.appendChild(showAllBtn);

  // Individual layer buttons
  layers.forEach(layer => {
    if (layer !== OUTLINE_LAYER && layer !== SILKSCREEN_LAYER && !displayMap[layer] && layer <= 16) return; // skip unpopulated layers <= 16
    const btn = document.createElement('button');
    btn.textContent = getLayerDisplayName(layer, displayMap, OUTLINE_LAYER, SILKSCREEN_LAYER, PART_OUTLINES_LAYER);

    const isVisible = defaultVisible.has(layer);
    if (isVisible) btn.classList.add('active');

    // Set the layer color for the circle indicator
    btn.style.setProperty('--layer-color', layerColors[layer]);

    btn.onclick = () => {
      const grp = layerGroups[layer];
      const visible = grp.getAttribute('display') !== 'none';
      grp.setAttribute('display', visible ? 'none' : 'inline');
      btn.classList.toggle('active', !visible);
      updateViaVisibility();
    };
    controls.appendChild(btn);
    layerButtons[layer] = btn;
  });

  // Initial via visibility synch
  updateViaVisibility();
  updateViaNumberVisibility();

  // Enable pan/zoom (re-initialise if previously set)
  if (window.pcbPanZoom) {
    window.pcbPanZoom.destroy();
  }
  window.pcbPanZoom = svgPanZoom(svg, {
    controlIconsEnabled: true,
    zoomScaleSensitivity: 0.3,
    minZoom: 0.1,
    maxZoom: 100,
    fit: true,
    center: true,
  });
}

// Try to automatically fetch the sample JSON file first
fetch('switch2.json')
  .then(res => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  })
  .then(json => {
    renderSegments(json);
  })
  .catch(err => {
    console.warn('Automatic fetch failed:', err);
    console.error('Failed to load switch2.json:', err.message);

    // Provide manual file-input fallback
    const controls = document.getElementById('controls');
    controls.innerHTML = '';

    const info = document.createElement('span');
    info.textContent = 'Select a JSON or PCB file: ';
    controls.appendChild(info);

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.pcb,application/json';
    input.onchange = () => {
      const file = input.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      
      if (file.name.toLowerCase().endsWith('.pcb')) {
        // Handle .pcb file using raw parser
        reader.onload = e => {
          try {
            const arrayBuffer = e.target.result;
            const parser = new RawPCBParser();
            const data = parser.parse(arrayBuffer);
            renderSegments(data);
          } catch (e) {
            controls.textContent = 'Invalid PCB file.';
            console.error('PCB parsing error:', e.message);
            console.error('Full error details:', e);
          }
        };
        reader.readAsArrayBuffer(file);
      } else {
        // Handle JSON file
        reader.onload = e => {
          try {
            const data = JSON.parse(e.target.result);
            renderSegments(data);
          } catch (e) {
            controls.textContent = 'Invalid JSON file.';
            console.error('JSON parsing error:', e.message);
            console.error('File content preview:', e.target.result.substring(0, 200) + '...');
            console.error('Full error details:', e);
          }
        };
        reader.readAsText(file);
      }
    };
    controls.appendChild(input);

    const hint = document.createElement('div');
    hint.style.fontSize = '0.75rem';
    hint.style.marginTop = '4px';
    hint.textContent = 'Input file can be a JSON file exported from ImHex using the XZZPCB pattern file, or a raw .pcb file';
    controls.appendChild(hint);
  });
