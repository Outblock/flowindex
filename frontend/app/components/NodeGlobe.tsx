import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect } from 'postprocessing';

export interface GlobeNode {
  lat: number;
  lon: number;
  role: number;
  tokens_staked: number;
}

const ROLE_COLORS: Record<number, number> = {
  1: 0x60a5fa, // Collection — blue
  2: 0xc084fc, // Consensus — purple
  3: 0xfb923c, // Execution — orange
  4: 0x4ade80, // Verification — green
  5: 0x22d3ee, // Access — cyan
};

const GLOBE_RADIUS = 1.6;
const DOT_BASE = 0.012;
const DOT_MAX = 0.035;
const ARC_INTERVAL = 1200;
const ARC_LIFE = 2400;
const ARCS_PER_SPAWN = 2;
const MAX_CONCURRENT_ARCS = 8;
const ARC_SEGMENTS = 64;
const SURFACE_DOT_COUNT = 18000;

const COUNTRIES_URL =
  'https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson';

function latLonToVec3(lat: number, lon: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function greatCircleArc(a: THREE.Vector3, b: THREE.Vector3, segments: number, elevate: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const aN = a.clone().normalize();
  const bN = b.clone().normalize();
  const angle = aN.angleTo(bN);
  const axis = new THREE.Vector3().crossVectors(aN, bN).normalize();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const q = new THREE.Quaternion().setFromAxisAngle(axis, angle * t);
    const pt = aN.clone().applyQuaternion(q);
    const lift = 1 + elevate * Math.sin(Math.PI * t);
    pt.multiplyScalar(GLOBE_RADIUS * lift);
    pts.push(pt);
  }
  return pts;
}

// Fibonacci sphere — evenly distributed points on sphere surface
function buildSurfaceDots(count: number, radius: number): THREE.Points {
  const positions = new Float32Array(count * 3);
  const goldenRatio = (1 + Math.sqrt(5)) / 2;

  for (let i = 0; i < count; i++) {
    const theta = (2 * Math.PI * i) / goldenRatio;
    const phi = Math.acos(1 - (2 * (i + 0.5)) / count);
    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * Math.cos(phi);
    const z = radius * Math.sin(phi) * Math.sin(theta);
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0x1a3a2a,
    size: 0.006,
    transparent: true,
    opacity: 0.6,
    sizeAttenuation: true,
  });
  return new THREE.Points(geo, mat);
}

// Parse GeoJSON coordinates into arrays of rings (each ring = array of [lon,lat])
function extractRings(geometry: any): number[][][] {
  const rings: number[][][] = [];
  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates) rings.push(ring);
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) rings.push(ring);
    }
  }
  return rings;
}

function buildCountryDots(geojson: any, radius: number): THREE.Points {
  const positions: number[] = [];

  for (const feature of geojson.features) {
    const rings = extractRings(feature.geometry);
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const steps = 4;
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const lon = ring[i][0] + (ring[i + 1][0] - ring[i][0]) * t;
          const lat = ring[i][1] + (ring[i + 1][1] - ring[i][1]) * t;
          const v = latLonToVec3(lat, lon, radius);
          positions.push(v.x, v.y, v.z);
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0x00e599,
    size: 0.008,
    transparent: true,
    opacity: 0.35,
    sizeAttenuation: true,
  });
  return new THREE.Points(geo, mat);
}

export default function NodeGlobe({ nodes }: { nodes: GlobeNode[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;

    // --- Renderer ---
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    // --- Camera ---
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 4.6);

    // --- Pivot group (everything that rotates) ---
    const pivot = new THREE.Group();
    scene.add(pivot);

    // --- Globe sphere (dark solid base) ---
    const globeGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);
    const globeMat = new THREE.MeshBasicMaterial({
      color: 0x050505,
      transparent: true,
      opacity: 0.95,
    });
    const globeMesh = new THREE.Mesh(globeGeo, globeMat);
    pivot.add(globeMesh);

    // --- Surface dot grid (fibonacci sphere — fills entire globe uniformly) ---
    const surfaceDots = buildSurfaceDots(SURFACE_DOT_COUNT, GLOBE_RADIUS * 1.001);
    pivot.add(surfaceDots);

    // --- Country border dots (async load, brighter than surface dots) ---
    const countryDisposables: THREE.Points[] = [];
    fetch(COUNTRIES_URL)
      .then((r) => r.json())
      .then((geojson) => {
        if (disposed) return;
        const dots = buildCountryDots(geojson, GLOBE_RADIUS * 1.002);
        countryDisposables.push(dots);
        pivot.add(dots);
      })
      .catch(() => {});

    // --- Node dots ---
    const maxStake = Math.max(...nodes.map((n) => n.tokens_staked), 1);
    const dotGroup = new THREE.Group();
    const dotGeo = new THREE.SphereGeometry(1, 8, 8);

    for (const n of nodes) {
      const pos = latLonToVec3(n.lat, n.lon, GLOBE_RADIUS * 1.008);
      const ratio = Math.sqrt(n.tokens_staked / maxStake);
      const size = DOT_BASE + (DOT_MAX - DOT_BASE) * ratio;
      const color = ROLE_COLORS[n.role] ?? 0x00e599;
      const mat = new THREE.MeshBasicMaterial({ color });
      const mesh = new THREE.Mesh(dotGeo, mat);
      mesh.position.copy(pos);
      mesh.scale.setScalar(size);
      dotGroup.add(mesh);
    }
    pivot.add(dotGroup);

    // --- Postprocessing (subtle bloom — only node dots & arcs glow) ---
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new BloomEffect({
      intensity: 0.6,
      luminanceThreshold: 0.35,
      luminanceSmoothing: 0.4,
      mipmapBlur: true,
    });
    composer.addPass(new EffectPass(camera, bloom));

    // --- Arcs ---
    const geoNodes = nodes.filter((n) => n.lat !== 0 || n.lon !== 0);
    const arcGroup = new THREE.Group();
    pivot.add(arcGroup);

    interface ArcData {
      line: THREE.Line;
      born: number;
    }
    const arcs: ArcData[] = [];
    let lastArc = performance.now();

    function spawnArc(now: number) {
      if (geoNodes.length < 2) return;
      const iA = Math.floor(Math.random() * geoNodes.length);
      let iB = Math.floor(Math.random() * (geoNodes.length - 1));
      if (iB >= iA) iB++;
      const a = latLonToVec3(geoNodes[iA].lat, geoNodes[iA].lon, GLOBE_RADIUS * 1.008);
      const b = latLonToVec3(geoNodes[iB].lat, geoNodes[iB].lon, GLOBE_RADIUS * 1.008);
      const pts = greatCircleArc(a, b, ARC_SEGMENTS, 0.15);
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({
        color: 0x00e599,
        transparent: true,
        opacity: 0.6,
      });
      const line = new THREE.Line(geo, mat);
      arcGroup.add(line);
      arcs.push({ line, born: now });
    }

    function updateArcs(now: number) {
      for (let i = arcs.length - 1; i >= 0; i--) {
        const age = now - arcs[i].born;
        if (age > ARC_LIFE) {
          arcGroup.remove(arcs[i].line);
          arcs[i].line.geometry.dispose();
          (arcs[i].line.material as THREE.Material).dispose();
          arcs.splice(i, 1);
        } else {
          const t = age / ARC_LIFE;
          let opacity: number;
          if (t < 0.3) opacity = t / 0.3;
          else if (t > 0.7) opacity = 1 - (t - 0.7) / 0.3;
          else opacity = 1;
          (arcs[i].line.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;

          const drawRange = Math.min(Math.floor((t / 0.4) * (ARC_SEGMENTS + 1)), ARC_SEGMENTS + 1);
          arcs[i].line.geometry.setDrawRange(0, drawRange);
        }
      }
    }

    // --- Interaction (drag to rotate) ---
    let isDragging = false;
    let prevMouse = { x: 0, y: 0 };
    let rotVelX = 0;
    let rotVelY = 0;

    const onPointerDown = (e: PointerEvent) => {
      isDragging = true;
      prevMouse = { x: e.clientX, y: e.clientY };
      rotVelX = 0;
      rotVelY = 0;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - prevMouse.x;
      const dy = e.clientY - prevMouse.y;
      rotVelY = dx * 0.005;
      rotVelX = dy * 0.005;
      pivot.rotation.y += rotVelY;
      pivot.rotation.x += rotVelX;
      pivot.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pivot.rotation.x));
      prevMouse = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = () => {
      isDragging = false;
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    // --- Resize ---
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      composer.setSize(width, height);
    });
    ro.observe(container);

    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      renderer.setSize(rect.width, rect.height);
      composer.setSize(rect.width, rect.height);
    }

    // --- Animation loop ---
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const now = performance.now();

      if (!isDragging) {
        pivot.rotation.y += 0.0015;
        rotVelX *= 0.95;
        rotVelY *= 0.95;
        pivot.rotation.y += rotVelY;
        pivot.rotation.x += rotVelX;
        pivot.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pivot.rotation.x));
      }

      if (now - lastArc > ARC_INTERVAL) {
        const count = Math.min(ARCS_PER_SPAWN, MAX_CONCURRENT_ARCS - arcs.length);
        for (let i = 0; i < count; i++) spawnArc(now);
        lastArc = now;
      }
      updateArcs(now);

      composer.render();
    };
    animate();

    // --- Cleanup ---
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);

      for (const a of arcs) {
        a.line.geometry.dispose();
        (a.line.material as THREE.Material).dispose();
      }

      for (const seg of countryDisposables) {
        seg.geometry.dispose();
        (seg.material as THREE.Material).dispose();
      }

      dotGroup.children.forEach((c) => {
        if (c instanceof THREE.Mesh) {
          c.geometry.dispose();
          (c.material as THREE.Material).dispose();
        }
      });
      dotGeo.dispose();
      surfaceDots.geometry.dispose();
      (surfaceDots.material as THREE.Material).dispose();
      globeGeo.dispose();
      globeMat.dispose();
      composer.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
    };
  }, [nodes]);

  return (
    <div
      ref={containerRef}
      className="w-full h-[420px] md:h-[480px] rounded-sm overflow-hidden cursor-grab active:cursor-grabbing"
      style={{ touchAction: 'none' }}
    />
  );
}
