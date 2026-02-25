import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface MiniNode {
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

const GLOBE_RADIUS = 1.2;
const SURFACE_DOT_COUNT = 3000;
const DOT_BASE = 0.015;
const DOT_MAX = 0.04;

function latLonToVec3(lat: number, lon: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function buildSurfaceDots(count: number, radius: number): THREE.Points {
  const positions = new Float32Array(count * 3);
  const goldenRatio = (1 + Math.sqrt(5)) / 2;
  for (let i = 0; i < count; i++) {
    const theta = (2 * Math.PI * i) / goldenRatio;
    const phi = Math.acos(1 - (2 * (i + 0.5)) / count);
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi);
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0x2d6b4a,
    size: 0.008,
    transparent: true,
    opacity: 0.5,
    sizeAttenuation: true,
  });
  return new THREE.Points(geo, mat);
}

export default function MiniGlobe({ nodes }: { nodes: MiniNode[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w === 0 || h === 0) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);
    camera.position.set(1.2, 0.4, 3.2);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    el.appendChild(renderer.domElement);

    const pivot = new THREE.Group();
    scene.add(pivot);

    // Globe sphere
    const globeGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 32, 32);
    const globeMat = new THREE.MeshBasicMaterial({
      color: 0x0a1a12,
      transparent: true,
      opacity: 0.6,
    });
    pivot.add(new THREE.Mesh(globeGeo, globeMat));

    // Surface dots
    pivot.add(buildSurfaceDots(SURFACE_DOT_COUNT, GLOBE_RADIUS * 1.002));

    // Node dots
    if (nodes.length > 0) {
      const maxStake = Math.max(...nodes.map((n) => n.tokens_staked), 1);
      const dotGeo = new THREE.SphereGeometry(1, 6, 6);
      for (const n of nodes) {
        const pos = latLonToVec3(n.lat, n.lon, GLOBE_RADIUS * 1.01);
        const ratio = Math.sqrt(n.tokens_staked / maxStake);
        const size = DOT_BASE + (DOT_MAX - DOT_BASE) * ratio;
        const color = ROLE_COLORS[n.role] ?? 0x00e599;
        const mat = new THREE.MeshBasicMaterial({ color });
        const mesh = new THREE.Mesh(dotGeo, mat);
        mesh.position.copy(pos);
        mesh.scale.setScalar(size);
        pivot.add(mesh);
      }
    }

    let frameId: number;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      pivot.rotation.y += 0.002;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [nodes]);

  return <div ref={containerRef} className="absolute inset-0" />;
}
