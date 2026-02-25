import { useEffect, useRef } from 'react';

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

const GLOBE_RADIUS = 1.3;
const SURFACE_DOT_COUNT = 3000;
const DOT_BASE = 0.025;
const DOT_MAX = 0.06;

export default function MiniGlobe({ nodes }: { nodes: MiniNode[] }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let frameId: number;
    let disposed = false;

    import('three').then((THREE) => {
      if (disposed) return;

      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === 0 || h === 0) return;

      function latLonToVec3(lat: number, lon: number, radius: number) {
        const phi = (90 - lat) * (Math.PI / 180);
        const theta = (lon + 180) * (Math.PI / 180);
        return new THREE.Vector3(
          -radius * Math.sin(phi) * Math.cos(theta),
          radius * Math.cos(phi),
          radius * Math.sin(phi) * Math.sin(theta),
        );
      }

      function buildSurfaceDots(count: number, radius: number) {
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
          color: 0x00e599,
          size: 0.012,
          transparent: true,
          opacity: 0.35,
          sizeAttenuation: true,
        });
        return new THREE.Points(geo, mat);
      }

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
      // Position globe in right half of card, slightly above center
      camera.position.set(0.8, 0.3, 2.8);
      camera.lookAt(0, 0, 0);

      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      el.appendChild(renderer.domElement);

      const pivot = new THREE.Group();
      scene.add(pivot);

      // Globe sphere — wireframe for visible structure against dark bg
      const globeGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 24, 24);
      const globeMat = new THREE.MeshBasicMaterial({
        color: 0x0d3d2b,
        transparent: true,
        opacity: 0.5,
        wireframe: true,
      });
      pivot.add(new THREE.Mesh(globeGeo, globeMat));

      // Inner solid sphere for depth
      const innerGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 0.99, 16, 16);
      const innerMat = new THREE.MeshBasicMaterial({
        color: 0x060f0b,
        transparent: true,
        opacity: 0.8,
      });
      pivot.add(new THREE.Mesh(innerGeo, innerMat));

      // Surface dots
      pivot.add(buildSurfaceDots(SURFACE_DOT_COUNT, GLOBE_RADIUS * 1.003));

      // Node dots
      if (nodes.length > 0) {
        const maxStake = Math.max(...nodes.map((n) => n.tokens_staked), 1);
        const dotGeo = new THREE.SphereGeometry(1, 6, 6);
        for (const n of nodes) {
          const pos = latLonToVec3(n.lat, n.lon, GLOBE_RADIUS * 1.015);
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

      const animate = () => {
        if (disposed) return;
        frameId = requestAnimationFrame(animate);
        pivot.rotation.y += 0.002;
        renderer.render(scene, camera);
      };
      animate();

      (el as any).__threeCleanup = () => {
        renderer.dispose();
        renderer.domElement.remove();
      };
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      (el as any).__threeCleanup?.();
    };
  }, [nodes]);

  return <div ref={containerRef} className="absolute inset-0" />;
}
