// The things on and around the island, built from simple shapes: the island itself and
// its dressing, the eight snacks, the ball and the yarn, the bath duck, the rain cloud,
// and the little pictures used for crumbs, stars, the moon and fireflies.
//
// THIS FILE IMPORTS three.js: it is only ever loaded through stage3d.ts, which the Island
// view imports dynamically. Everything made here is owned by the stage, which disposes
// of it (`disposeTree`) when the view is left.

import {
  CanvasTexture, CapsuleGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, SRGBColorSpace,
  SphereGeometry, TorusGeometry, type BufferGeometry, type Material, type Object3D, type Texture,
} from 'three';
import type { FoodId } from '../../core/contract';
import { ISLAND, groundY } from './layout';
import type { ParticleKind, PlayToy } from './world';

const standard = (color: number, roughness = 0.85): MeshStandardMaterial => new MeshStandardMaterial({ color, roughness });

function mesh(geometry: BufferGeometry, material: Material, options: { shadow?: boolean; receive?: boolean } = {}): Mesh {
  const m = new Mesh(geometry, material);
  m.castShadow = options.shadow ?? true;
  m.receiveShadow = options.receive ?? false;
  return m;
}

/** A small repeatable random source, so the island is dressed the same way every time. */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Free every geometry, material and texture under `root`. */
export function disposeTree(root: Object3D): void {
  root.traverse((node) => {
    const item = node as Mesh;
    item.geometry?.dispose();
    const materials = Array.isArray(item.material) ? item.material : item.material ? [item.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value && typeof value === 'object' && (value as Texture).isTexture) (value as Texture).dispose();
      }
      material.dispose();
    }
  });
}

// ---- the island ------------------------------------------------------------------------------

export function buildIsland(): Group {
  const island = new Group();
  island.name = 'island';
  const random = mulberry(7);
  const between = (lo: number, hi: number): number => lo + random() * (hi - lo);

  const grass = mesh(new SphereGeometry(ISLAND.radius, 56, 24), standard(0xa6e6a4, 0.95), { shadow: false, receive: true });
  grass.scale.y = ISLAND.dome / ISLAND.radius;
  grass.position.y = ISLAND.centreY;

  // The earth underneath: half a ball, pulled about so that it is lumpy.
  const earthGeometry = new SphereGeometry(ISLAND.earthRadius, 40, 20, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const points = earthGeometry.attributes.position;
  if (points) {
    for (let i = 0; i < points.count; i++) {
      const x = points.getX(i);
      const y = points.getY(i);
      const z = points.getZ(i);
      const lump = 1 + 0.07 * Math.sin(x * 5.1 + z * 3.3) + 0.05 * Math.sin(z * 7.7 - x * 2.1);
      points.setXYZ(i, x * lump, y * (ISLAND.earthDepth / ISLAND.earthRadius) * lump, z * lump);
    }
    earthGeometry.computeVertexNormals();
  }
  const earthMaterial = standard(0xd3a373, 1);
  // The bowl is open on top: never show a see-through sliver under the grass.
  earthMaterial.side = DoubleSide;
  const earth = mesh(earthGeometry, earthMaterial, { shadow: false });
  earth.position.y = ISLAND.centreY;
  island.add(grass, earth);

  const place = (object: Object3D, angle: number, r: number): void => {
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    object.position.set(x, groundY(x, z), z);
    island.add(object);
  };

  // Flowers round the edge.
  const stemMaterial = standard(0x6fc48a, 0.9);
  const coreMaterial = standard(0xffd25e, 0.6);
  const stemGeometry = new CylinderGeometry(0.014, 0.018, 0.2, 6);
  const petalGeometry = new SphereGeometry(0.045, 10, 8);
  const coreGeometry = new SphereGeometry(0.04, 10, 8);
  const petals = [standard(0xffffff, 0.6), standard(0xffc6dd, 0.6), standard(0xfff1a8, 0.6)];
  const flowers: readonly (readonly [number, number, number, number])[] = [[-2.2, 1.5, 1, 0], [-1.2, 1.62, 0.8, 1], [-0.35, 1.52, 1.1, 0], [3.5, 1.6, 0.9, 2], [1.15, 1.6, 0.85, 1]];
  for (const [angle, r, size, colour] of flowers) {
    const flower = new Group();
    const stem = mesh(stemGeometry, stemMaterial);
    stem.position.y = 0.1;
    const head = new Group();
    head.position.y = 0.22;
    for (let i = 0; i < 5; i++) {
      const petal = mesh(petalGeometry, petals[colour] as Material);
      petal.position.set(Math.cos((i / 5) * Math.PI * 2) * 0.055, 0, Math.sin((i / 5) * Math.PI * 2) * 0.055);
      petal.scale.y = 0.6;
      head.add(petal);
    }
    const core = mesh(coreGeometry, coreMaterial);
    core.position.y = 0.012;
    head.add(core);
    head.rotation.x = 0.5;
    flower.add(stem, head);
    flower.scale.setScalar(size);
    place(flower, angle, r);
  }

  // A mushroom and its little one.
  const capMaterial = standard(0xff8fa3, 0.6);
  const stalkMaterial = standard(0xfff3e0, 0.8);
  const dotMaterial = standard(0xffffff, 0.6);
  const stalkGeometry = new CylinderGeometry(0.05, 0.065, 0.14, 12);
  const capGeometry = new SphereGeometry(0.13, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const dotGeometry = new SphereGeometry(0.02, 8, 6);
  for (const [angle, r, size] of [[2.55, 1.55, 1], [2.78, 1.66, 0.55]] as const) {
    const mushroom = new Group();
    const stalk = mesh(stalkGeometry, stalkMaterial);
    stalk.position.y = 0.07;
    const cap = mesh(capGeometry, capMaterial);
    cap.position.y = 0.12;
    cap.scale.y = 0.8;
    mushroom.add(stalk, cap);
    for (const [dx, dy, dz] of [[0.05, 0.2, 0.06], [-0.06, 0.19, 0.04], [0, 0.215, -0.04]] as const) {
      const dot = mesh(dotGeometry, dotMaterial, { shadow: false });
      dot.position.set(dx, dy, dz);
      mushroom.add(dot);
    }
    mushroom.scale.setScalar(size);
    place(mushroom, angle, r);
  }

  // Tufts of grass and a few pebbles.
  const bladeGeometry = new ConeGeometry(0.03, 0.14, 5);
  for (let i = 0; i < 11; i++) {
    const tuft = new Group();
    for (let k = 0; k < 2; k++) {
      const blade = mesh(bladeGeometry, stemMaterial, { shadow: false });
      blade.position.set(k * 0.035, 0.06, 0);
      blade.rotation.z = between(-0.3, 0.3);
      blade.scale.setScalar(k === 0 ? 1 : 0.7);
      tuft.add(blade);
    }
    place(tuft, between(0, Math.PI * 2), between(1.45, 1.75));
  }
  const pebbleMaterial = standard(0xcfc6c0, 0.9);
  const pebbleGeometry = new SphereGeometry(0.07, 10, 8);
  for (const [angle, r, size] of [[0.35, 1.62, 1], [0.55, 1.7, 0.6], [4.3, 1.58, 0.8]] as const) {
    const pebble = mesh(pebbleGeometry, pebbleMaterial);
    pebble.scale.set(size, size * 0.6, size * 0.8);
    place(pebble, angle, r);
  }
  return island;
}

/** A small fluffy cloud. Used for the two that hang over the island and for the rain cloud. */
export function buildCloud(): Group {
  const cloud = new Group();
  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xdfe8ff, emissiveIntensity: 0.35 });
  const geometry = new SphereGeometry(0.2, 16, 12);
  for (const [x, y, z, s] of [[0, 0, 0, 1], [0.22, -0.02, 0.02, 0.8], [-0.23, -0.03, 0, 0.78], [0.08, 0.1, -0.02, 0.82], [-0.1, 0.07, 0.03, 0.7]] as const) {
    const puff = mesh(geometry, material, { shadow: false });
    puff.position.set(x, y, z);
    puff.scale.set(s, s * 0.8, s * 0.8);
    cloud.add(puff);
  }
  return cloud;
}

// ---- snacks: a different one each time ----------------------------------------------------------

/** One of the eight foods, standing on y = 0 and about half a unit across. */
export function buildSnack(food: FoodId, random: () => number): Group {
  const snack = new Group();
  const between = (lo: number, hi: number): number => lo + random() * (hi - lo);
  switch (food) {
    case 'apple': {
      const apple = mesh(new SphereGeometry(0.25, 24, 16), standard(0xff6b6b, 0.45));
      apple.scale.y = 0.92;
      apple.position.y = 0.23;
      const stem = mesh(new CylinderGeometry(0.014, 0.02, 0.11, 6), standard(0x8a5a3c, 0.9));
      stem.position.set(0, 0.48, 0);
      const leaf = mesh(new SphereGeometry(0.08, 10, 8), standard(0x7fcb9a, 0.8));
      leaf.scale.set(1, 0.22, 0.55);
      leaf.position.set(0.07, 0.5, 0);
      leaf.rotation.z = 0.5;
      snack.add(apple, stem, leaf);
      break;
    }
    case 'bread': {
      const crust = standard(0xe3a45c, 0.9);
      const loaf = mesh(new SphereGeometry(0.24, 24, 16), crust);
      loaf.scale.set(1.25, 0.72, 0.85);
      loaf.position.y = 0.17;
      snack.add(loaf);
      const score = standard(0xf7d9a4, 0.9);
      const scoreGeometry = new CapsuleGeometry(0.022, 0.16, 4, 8);
      for (const x of [-0.13, 0, 0.13]) {
        const cut = mesh(scoreGeometry, score, { shadow: false });
        cut.position.set(x, 0.335 - Math.abs(x) * 0.12, 0.03);
        cut.rotation.set(Math.PI / 2, 0, 0.5);
        snack.add(cut);
      }
      break;
    }
    case 'carrot': {
      const root = mesh(new ConeGeometry(0.13, 0.5, 16), standard(0xff9a4a, 0.7));
      root.rotation.z = Math.PI / 2 + 0.12;
      root.position.set(0.03, 0.13, 0);
      snack.add(root);
      const leafMaterial = standard(0x6fc48a, 0.85);
      const leafGeometry = new ConeGeometry(0.045, 0.2, 6);
      for (const [dy, dz, tilt] of [[0.05, 0, 0.2], [0, 0.05, -0.25], [-0.02, -0.05, 0.5]] as const) {
        const leaf = mesh(leafGeometry, leafMaterial);
        leaf.position.set(-0.3, 0.17 + dy, dz);
        leaf.rotation.z = Math.PI / 2 + tilt;
        snack.add(leaf);
      }
      break;
    }
    case 'biscuit': {
      const biscuit = mesh(new CylinderGeometry(0.25, 0.25, 0.08, 28), standard(0xf1c886, 0.9));
      biscuit.position.y = 0.05;
      snack.add(biscuit);
      const hole = standard(0xd09a55, 0.9);
      const holeGeometry = new SphereGeometry(0.022, 8, 6);
      for (let i = 0; i < 6; i++) {
        const dimple = mesh(holeGeometry, hole, { shadow: false });
        dimple.position.set(Math.cos((i / 6) * Math.PI * 2) * 0.14, 0.092, Math.sin((i / 6) * Math.PI * 2) * 0.14);
        dimple.scale.y = 0.4;
        snack.add(dimple);
      }
      const middle = mesh(holeGeometry, hole, { shadow: false });
      middle.position.y = 0.092;
      middle.scale.y = 0.4;
      snack.add(middle);
      snack.rotation.x = 0.35;
      break;
    }
    case 'cookie': {
      const cookie = mesh(new CylinderGeometry(0.27, 0.27, 0.09, 28), standard(0xe2ad6b, 0.9));
      cookie.position.y = 0.05;
      snack.add(cookie);
      const chipMaterial = standard(0x6b4636, 0.6);
      const chipGeometry = new SphereGeometry(0.035, 8, 6);
      for (let i = 0; i < 7; i++) {
        const chip = mesh(chipGeometry, chipMaterial, { shadow: false });
        const a = between(0, Math.PI * 2);
        const r = between(0.03, 0.2);
        chip.position.set(Math.cos(a) * r, 0.1, Math.sin(a) * r);
        snack.add(chip);
      }
      snack.rotation.x = 0.35;
      break;
    }
    case 'donut': {
      const base = mesh(new TorusGeometry(0.18, 0.105, 14, 28), standard(0xe9b872, 0.9));
      base.rotation.x = Math.PI / 2;
      base.position.y = 0.105;
      const icing = mesh(new TorusGeometry(0.18, 0.098, 14, 28), standard(0xff9ec0, 0.5), { shadow: false });
      icing.rotation.x = Math.PI / 2;
      icing.scale.z = 0.72;
      icing.position.y = 0.15;
      snack.add(base, icing);
      const sprinkleGeometry = new CapsuleGeometry(0.008, 0.03, 2, 4);
      const colours = [0xffffff, 0xffd25e, 0x8fd3ff, 0xa9e8cf].map((colour) => standard(colour, 0.6));
      for (let i = 0; i < 9; i++) {
        const sprinkle = mesh(sprinkleGeometry, colours[i % colours.length] as Material, { shadow: false });
        const a = (i / 9) * Math.PI * 2 + between(-0.2, 0.2);
        sprinkle.position.set(Math.cos(a) * 0.18, 0.223, Math.sin(a) * 0.18);
        sprinkle.rotation.set(Math.PI / 2, 0, between(0, 3));
        snack.add(sprinkle);
      }
      break;
    }
    case 'strawberry': {
      const berryGeometry = new SphereGeometry(0.22, 20, 16);
      const points = berryGeometry.attributes.position;
      if (points) {
        // Pull the bottom into a point.
        for (let i = 0; i < points.count; i++) {
          const y = points.getY(i);
          const taper = y < 0 ? 1 + (y / 0.22) * 0.55 : 1;
          points.setXYZ(i, points.getX(i) * taper, y * (y < 0 ? 1.35 : 0.8), points.getZ(i) * taper);
        }
        berryGeometry.computeVertexNormals();
      }
      const berry = mesh(berryGeometry, standard(0xff5a6e, 0.4));
      berry.position.y = 0.3;
      snack.add(berry);
      const seedMaterial = standard(0xffe9a8, 0.6);
      const seedGeometry = new SphereGeometry(0.014, 6, 5);
      for (let i = 0; i < 12; i++) {
        const seed = mesh(seedGeometry, seedMaterial, { shadow: false });
        const a = (i / 12) * Math.PI * 2 + (i % 2) * 0.3;
        const h = (i % 3) * 0.085 - 0.1;
        const r = 0.2 * (h < 0 ? 1 + (h / 0.22) * 0.5 : Math.sqrt(Math.max(0.05, 1 - (h / 0.19) ** 2)));
        seed.position.set(Math.cos(a) * r, 0.3 + h, Math.sin(a) * r);
        snack.add(seed);
      }
      const leafMaterial = standard(0x6fc48a, 0.85);
      const leafGeometry = new ConeGeometry(0.05, 0.14, 5);
      for (let i = 0; i < 5; i++) {
        const leaf = mesh(leafGeometry, leafMaterial, { shadow: false });
        const a = (i / 5) * Math.PI * 2;
        leaf.position.set(Math.cos(a) * 0.07, 0.475, Math.sin(a) * 0.07);
        leaf.rotation.set(Math.sin(a) * 1.25, 0, -Math.cos(a) * 1.25);
        snack.add(leaf);
      }
      break;
    }
    case 'onigiri': {
      const rice = mesh(new CylinderGeometry(0.3, 0.3, 0.2, 3, 1), standard(0xfffdf6, 0.95));
      rice.geometry.computeVertexNormals();
      rice.rotation.set(Math.PI / 2, 0, 0);
      rice.position.y = 0.2;
      const corners = standard(0xfffdf6, 0.95);
      const cornerGeometry = new SphereGeometry(0.1, 12, 10);
      // Round the three corners.
      for (let i = 0; i < 3; i++) {
        const a = Math.PI / 2 + (i / 3) * Math.PI * 2;
        const corner = mesh(cornerGeometry, corners);
        corner.position.set(Math.cos(a) * 0.2, 0.2 + Math.sin(a) * 0.2, 0);
        corner.scale.z = 1;
        snack.add(corner);
      }
      const nori = mesh(new CylinderGeometry(0.31, 0.31, 0.16, 3, 1, false, 0, Math.PI * 2), standard(0x2f3a36, 0.7));
      nori.rotation.set(Math.PI / 2, 0, 0);
      nori.scale.set(0.5, 1.32, 0.34);
      nori.position.set(0, 0.11, 0);
      snack.add(rice, nori);
      break;
    }
  }
  return snack;
}

// ---- toys ------------------------------------------------------------------------------------------

function canvas(width: number, height: number, draw: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  const g = el.getContext('2d');
  if (g) draw(g);
  const texture = new CanvasTexture(el);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function buildBall(toy: PlayToy, radius: number): Mesh {
  const texture = toy === 'yarn'
    ? canvas(256, 128, (g) => {
      g.fillStyle = '#ff9ec0';
      g.fillRect(0, 0, 256, 128);
      g.lineWidth = 5;
      g.lineCap = 'round';
      // Strands wound round and round, in two shades.
      for (let i = -8; i < 24; i++) {
        g.strokeStyle = i % 2 === 0 ? '#ffc2d9' : '#f2729f';
        g.beginPath(); g.moveTo(i * 16, -4); g.lineTo(i * 16 + 110, 132); g.stroke();
        g.strokeStyle = i % 2 === 0 ? '#f98bb3' : '#ffd6e6';
        g.beginPath(); g.moveTo(i * 16 + 120, -4); g.lineTo(i * 16 - 10, 132); g.stroke();
      }
    })
    : canvas(256, 64, (g) => {
      ['#ff8fa3', '#ffffff', '#8fd3ff', '#ffffff', '#ffd25e', '#ffffff'].forEach((colour, i) => {
        g.fillStyle = colour;
        g.fillRect((i * 256) / 6, 0, 256 / 6 + 1, 64);
      });
    });
  const ball = mesh(new SphereGeometry(radius, 28, 18), new MeshStandardMaterial({ map: texture, roughness: toy === 'yarn' ? 0.95 : 0.4 }));
  ball.name = toy;
  return ball;
}

/** A rubber duck for bath time, standing on y = 0. */
export function buildDuck(): Group {
  const duck = new Group();
  const yellow = standard(0xffd84d, 0.35);
  const body = mesh(new SphereGeometry(0.2, 20, 14), yellow);
  body.scale.set(1.1, 0.8, 0.9);
  body.position.y = 0.16;
  const tail = mesh(new ConeGeometry(0.08, 0.14, 10), yellow);
  tail.position.set(-0.2, 0.24, 0);
  tail.rotation.z = 0.9;
  const head = mesh(new SphereGeometry(0.13, 18, 12), yellow);
  head.position.set(0.14, 0.38, 0);
  const beak = mesh(new ConeGeometry(0.05, 0.11, 10), standard(0xff8f3d, 0.4));
  beak.position.set(0.28, 0.36, 0);
  beak.rotation.z = -Math.PI / 2;
  beak.scale.z = 1.4;
  duck.add(body, tail, head, beak);
  const ink = standard(0x2b1e1a, 0.2);
  const eyeGeometry = new SphereGeometry(0.02, 8, 6);
  for (const z of [-0.075, 0.075]) {
    const eye = mesh(eyeGeometry, ink, { shadow: false });
    eye.position.set(0.21, 0.42, z);
    duck.add(eye);
  }
  return duck;
}

// ---- small pictures ----------------------------------------------------------------------------------

export type Glyph = ParticleKind | 'moon' | 'glow' | 'sky';

export function buildGlyph(kind: Glyph): CanvasTexture {
  const size = kind === 'sky' ? 128 : 64;
  return canvas(size, size, (g) => {
    g.translate(size / 2, size / 2);
    if (kind === 'star') {
      g.fillStyle = '#ffd25e';
      g.beginPath();
      g.moveTo(0, -28); g.quadraticCurveTo(4, -4, 28, 0); g.quadraticCurveTo(4, 4, 0, 28);
      g.quadraticCurveTo(-4, 4, -28, 0); g.quadraticCurveTo(-4, -4, 0, -28);
      g.fill();
    } else if (kind === 'crumb') {
      g.fillStyle = '#e2a960';
      g.beginPath(); g.arc(0, 0, 11, 0, Math.PI * 2); g.fill();
    } else if (kind === 'drop') {
      g.fillStyle = 'rgba(150, 205, 255, .95)';
      g.beginPath(); g.moveTo(0, -24); g.bezierCurveTo(16, -2, 14, 20, 0, 20); g.bezierCurveTo(-14, 20, -16, -2, 0, -24); g.fill();
      g.fillStyle = 'rgba(255, 255, 255, .8)';
      g.beginPath(); g.arc(-4, 6, 4, 0, Math.PI * 2); g.fill();
    } else if (kind === 'glow') {
      const glow = g.createRadialGradient(0, 0, 0, 0, 0, 30);
      glow.addColorStop(0, 'rgba(255, 244, 170, 1)');
      glow.addColorStop(0.3, 'rgba(255, 230, 120, .55)');
      glow.addColorStop(1, 'rgba(255, 230, 120, 0)');
      g.fillStyle = glow;
      g.fillRect(-32, -32, 64, 64);
    } else if (kind === 'moon') {
      g.fillStyle = '#fff6d6';
      g.beginPath(); g.arc(0, 0, 26, 0, Math.PI * 2); g.fill();
      g.globalCompositeOperation = 'destination-out';
      g.beginPath(); g.arc(12, -8, 22, 0, Math.PI * 2); g.fill();
    } else {
      // The night sky: a soft dark-blue glow that fades out, so night reads on any wallpaper.
      const sky = g.createRadialGradient(0, 0, 4, 0, 0, 64);
      sky.addColorStop(0, 'rgba(46, 52, 110, .92)');
      sky.addColorStop(0.55, 'rgba(40, 44, 98, .72)');
      sky.addColorStop(0.85, 'rgba(34, 36, 84, .22)');
      sky.addColorStop(1, 'rgba(34, 36, 84, 0)');
      g.fillStyle = sky;
      g.fillRect(-64, -64, 128, 128);
    }
  });
}
