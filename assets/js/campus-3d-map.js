import * as THREE from 'https://esm.sh/three@0.164.1';
import { OrbitControls } from 'https://esm.sh/three@0.164.1/examples/jsm/controls/OrbitControls.js';

(() => {
  const button = document.getElementById('toggle3DView');
  const mapElement = document.getElementById('map');
  const wrapper = document.getElementById('map-wrapper');
  if (!button || !mapElement || !wrapper || !window.CampusApi) return;

  const view = document.createElement('section');
  view.id = 'campus3DView';
  view.className = 'campus-3d-view hidden';
  view.setAttribute('aria-label', 'Interactive three-dimensional campus model');
  view.innerHTML = '<canvas id="campus3DCanvas"></canvas><div class="campus-3d-overlay"><strong>3D Campus View</strong><span>Drag to rotate · Scroll to zoom · Select a building for accessibility details</span><div class="campus-3d-legend"><span><i class="accessible"></i> Accessible</span><span><i class="unverified"></i> Not verified</span><span><i class="inaccessible"></i> Not accessible</span></div><div id="campus3DInfo" role="status" aria-live="polite">Select a building or facility to view its information.</div></div>';
  wrapper.append(view);

  let renderer, scene, camera, controls, resizeObserver, animationId;
  let loaded = false;
  let pickables = [];
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const info = view.querySelector('#campus3DInfo');

  function addLabel(text, x, z, color = '#172554') {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 512;
    canvas.height = 128;
    context.fillStyle = 'rgba(255,255,255,.94)';
    context.strokeStyle = 'rgba(15,23,42,.22)';
    context.lineWidth = 5;
    context.roundRect(4, 4, 504, 120, 18);
    context.fill();
    context.stroke();
    context.fillStyle = color;
    context.font = 'bold 34px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const label = String(text || 'Campus location');
    context.fillText(label.length > 25 ? label.slice(0, 23) + '…' : label, 256, 64);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.position.set(x, 13, z);
    sprite.scale.set(19, 4.75, 1);
    scene.add(sprite);
  }

  function initialize() {
    if (loaded) return;
    const canvas = document.getElementById('campus3DCanvas');
    const width = Math.max(view.clientWidth, 320);
    const height = Math.max(view.clientHeight, 320);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0xeaf1f8, 1);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeaf1f8);
    scene.fog = new THREE.Fog(0xeaf1f8, 1300, 2600);

    camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 5000);
    camera.position.set(940, 1050, 1120);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = 250;
    controls.maxDistance = 2600;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x718096, 2.0));
    const sunlight = new THREE.DirectionalLight(0xffffff, 2.2);
    sunlight.position.set(700, 1200, 600);
    sunlight.castShadow = true;
    scene.add(sunlight);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1330, 1620),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(1330, 26, 0xcbd5e1, 0xe2e8f0);
    grid.position.y = -1.8;
    scene.add(grid);

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(1334, 2, 1624),
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, transparent: true, opacity: 0.32 })
    );
    frame.position.y = -3;
    scene.add(frame);
    loaded = true;
  }

  function position(x, y) {
    return [Number(x) - 665, Number(y) - 810];
  }

  function addWalkways(nodes, connections) {
    const byId = new Map((nodes || []).map(node => [String(node.id), node]));
    (connections || []).forEach(edge => {
      const a = byId.get(String(edge.from_node_id));
      const b = byId.get(String(edge.to_node_id));
      if (!a || !b) return;
      const [ax, az] = position(a.x, a.y);
      const [bx, bz] = position(b.x, b.y);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(ax, 0, az),
          new THREE.Vector3(bx, 0.3, bz)
        ]),
        new THREE.LineBasicMaterial({
          color: edge.accessible_confirmed ? 0x0f9d76 : 0x94a3b8,
          transparent: true,
          opacity: edge.accessible_confirmed ? 0.95 : 0.58
        })
      );
      scene.add(line);
    });
  }

  function addLocation(marker, record) {
    const [x, z] = position(marker.x, marker.y);
    const isBuilding = marker.kind === 'building';
    const status = record?.accessibility_status ?? marker.accessibility_value;
    const accessible = status === true || Number(status) === 1;
    const notAccessible = status === false || Number(status) === 0;
    const color = accessible ? 0x16a34a : notAccessible ? 0xdc4545 : 0x64748b;
    const height = isBuilding ? 18 + Math.max(1, Number(record?.floor_count || 1)) * 5 : 10;
    const width = isBuilding ? 36 : 25;
    const depth = isBuilding ? 30 : 22;

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(width + 5, 2, depth + 5),
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.9 })
    );
    base.position.set(x, 0, z);
    base.receiveShadow = true;
    scene.add(base);

    const building = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.03 })
    );
    building.position.set(x, height / 2 + 1, z);
    building.castShadow = true;
    building.receiveShadow = true;
    building.userData = { marker, record, status, name: marker.name || record?.name || 'Campus location' };
    scene.add(building);
    pickables.push(building);
    addLabel(marker.name || record?.name || 'Campus location', x, z - depth * 0.7);

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(width + 1, 2, depth + 1),
      new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.8 })
    );
    roof.position.set(x, height + 2, z);
    scene.add(roof);
  }

  async function build() {
    initialize();
    info.textContent = 'Loading campus locations…';
    const [mapData, directory] = await Promise.all([
      window.CampusApi.get('map'),
      window.CampusApi.get('directory')
    ]);
    const locationById = new Map((directory.locations || []).map(row => [String(row.id), row]));
    scene.clear();
    pickables = [];
    scene.add(new THREE.HemisphereLight(0xffffff, 0x718096, 2.0));
    const sunlight = new THREE.DirectionalLight(0xffffff, 2.2);
    sunlight.position.set(700, 1200, 600);
    sunlight.castShadow = true;
    scene.add(sunlight);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1330, 1620), new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2;
    ground.receiveShadow = true;
    scene.add(ground);
    scene.add(new THREE.GridHelper(1330, 26, 0xcbd5e1, 0xe2e8f0));
    addWalkways(mapData.nodes, mapData.connections);
    (mapData.markers || []).forEach(marker => addLocation(marker, locationById.get(String(marker.location_id))));
    info.textContent = `${(mapData.markers || []).length} mapped locations · ${(mapData.connections || []).length} walkway connections`;
    if (mapData.markers?.length) {
      const points = mapData.markers.map(marker => position(marker.x, marker.y));
      const xs = points.map(point => point[0]), zs = points.map(point => point[1]);
      controls.target.set((Math.min(...xs) + Math.max(...xs)) / 2, 0, (Math.min(...zs) + Math.max(...zs)) / 2);
    }
  }

  function animate() {
    animationId = requestAnimationFrame(animate);
    controls?.update();
    renderer?.render(scene, camera);
  }

  function resize() {
    if (!renderer || !camera) return;
    const width = Math.max(view.clientWidth, 320);
    const height = Math.max(view.clientHeight, 320);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  function showInfo(object) {
    const { marker, record, status } = object.userData;
    const features = record?.accessibility_features || [];
    const accessText = status === true || Number(status) === 1 ? 'Accessible' : status === false || Number(status) === 0 ? 'Not accessible' : 'Not yet verified';
    info.innerHTML = `<strong>${String(marker.name || record?.name || 'Campus location').replace(/[&<>"']/g, '')}</strong><br>Accessibility: ${accessText}${features.length ? '<br>Features: ' + features.map(value => String(value).replaceAll('_',' ')).join(', ') : ''}`;
  }

  renderer?.domElement?.addEventListener('click', () => {});
  view.addEventListener('click', event => {
    if (!renderer || !camera || event.target.closest('.campus-3d-overlay')) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickables, false)[0];
    if (hit) showInfo(hit.object);
  });

  button.addEventListener('click', async () => {
    const entering = view.classList.contains('hidden');
    if (entering) {
      view.classList.remove('hidden');
      mapElement.classList.add('hidden');
      wrapper.querySelector('.absolute.top-3.left-3')?.classList.add('hidden');
      document.getElementById('showAllBtn')?.classList.add('hidden');
      button.textContent = '2D Map';
      button.setAttribute('aria-pressed', 'true');
      try {
        await build();
        resize();
        if (!animationId) animate();
      } catch (error) {
        info.textContent = 'The 3D campus view could not load: ' + error.message;
      }
    } else {
      view.classList.add('hidden');
      mapElement.classList.remove('hidden');
      wrapper.querySelector('.absolute.top-3.left-3')?.classList.remove('hidden');
      button.textContent = '3D View';
      button.setAttribute('aria-pressed', 'false');
      window.dispatchEvent(new Event('resize'));
    }
  });

  if ('ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(view);
  } else {
    window.addEventListener('resize', resize);
  }
})();
