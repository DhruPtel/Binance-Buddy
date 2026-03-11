// =============================================================================
// BuddyRenderer — Three.js voxel buddy with idle animation and mood expressions
// =============================================================================

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { MOOD_COLOR } from '@binancebuddy/buddy';
import type { Mood, EvolutionStage } from '@binancebuddy/core';

interface BuddyRendererProps {
  mood: Mood;
  stage: EvolutionStage;
  size?: number; // canvas size in px (square)
}

// ---------------------------------------------------------------------------
// Stage-based colour palette for the body
// ---------------------------------------------------------------------------

const STAGE_COLOR: Record<EvolutionStage, number> = {
  seedling: 0x90ee90,   // light green
  sprout:   0x32cd32,   // lime green
  bloom:    0xff69b4,   // hot pink
  guardian: 0x4169e1,   // royal blue
  apex:     0xffd700,   // gold
};

// ---------------------------------------------------------------------------
// Build voxel creature from Box geometries
// ---------------------------------------------------------------------------

function buildCreature(stage: EvolutionStage, mood: Mood): THREE.Group {
  const group = new THREE.Group();
  const bodyColor = STAGE_COLOR[stage];
  const eyeColor = parseInt(MOOD_COLOR[mood].replace('#', ''), 16);

  const mat = (color: number) =>
    new THREE.MeshLambertMaterial({ color });

  // Body (main cube)
  const bodyScale = stage === 'seedling' ? 0.6
    : stage === 'sprout' ? 0.75
    : stage === 'bloom' ? 0.9
    : stage === 'guardian' ? 1.0
    : 1.1; // apex

  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat(bodyColor));
  body.scale.setScalar(bodyScale);
  group.add(body);

  // Head (smaller cube on top)
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), mat(bodyColor));
  head.position.set(0, 0.85 * bodyScale, 0);
  group.add(head);

  // Eyes (tiny cubes on head face)
  const eyeSize = 0.12;
  const leftEye = new THREE.Mesh(new THREE.BoxGeometry(eyeSize, eyeSize, eyeSize), mat(eyeColor));
  leftEye.position.set(-0.18, 0.85 * bodyScale + 0.08, 0.36);
  group.add(leftEye);

  const rightEye = new THREE.Mesh(new THREE.BoxGeometry(eyeSize, eyeSize, eyeSize), mat(eyeColor));
  rightEye.position.set(0.18, 0.85 * bodyScale + 0.08, 0.36);
  group.add(rightEye);

  // Cheek blush for happy/ecstatic
  if (mood === 'happy' || mood === 'ecstatic') {
    const blushMat = new THREE.MeshLambertMaterial({ color: 0xff9999, transparent: true, opacity: 0.7 });
    const leftBlush = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.05), blushMat);
    leftBlush.position.set(-0.24, 0.85 * bodyScale - 0.02, 0.37);
    group.add(leftBlush);
    const rightBlush = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.05), blushMat);
    rightBlush.position.set(0.24, 0.85 * bodyScale - 0.02, 0.37);
    group.add(rightBlush);
  }

  // Worry brow for worried/anxious
  if (mood === 'worried' || mood === 'anxious') {
    const browMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
    const leftBrow = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.05), browMat);
    leftBrow.position.set(-0.18, 0.85 * bodyScale + 0.2, 0.37);
    leftBrow.rotation.z = 0.3;
    group.add(leftBrow);
    const rightBrow = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.05), browMat);
    rightBrow.position.set(0.18, 0.85 * bodyScale + 0.2, 0.37);
    rightBrow.rotation.z = -0.3;
    group.add(rightBrow);
  }

  // Apex crown
  if (stage === 'apex') {
    const crownMat = new THREE.MeshLambertMaterial({ color: 0xffd700 });
    for (let i = 0; i < 3; i++) {
      const spike = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.12), crownMat);
      spike.position.set((i - 1) * 0.22, 0.85 * bodyScale + 0.46, 0);
      group.add(spike);
    }
  }

  return group;
}

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

export function BuddyRenderer({ mood, stage, size = 200 }: BuddyRendererProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 1, 4);
    camera.lookAt(0, 0.5, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(size, size);
    renderer.setPixelRatio(window.devicePixelRatio);
    mount.appendChild(renderer.domElement);

    // Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(3, 5, 3);
    scene.add(dirLight);

    // Buddy
    const creature = buildCreature(stage, mood);
    scene.add(creature);

    // Idle animation
    let frame = 0;
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      frame++;

      // Gentle bob
      creature.position.y = Math.sin(frame * 0.03) * 0.08;
      // Slow rotate
      creature.rotation.y = Math.sin(frame * 0.01) * 0.3;
      // Ecstatic — faster spin
      if (mood === 'ecstatic') {
        creature.rotation.y = frame * 0.04;
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      renderer.dispose();
      if (mount.contains(renderer.domElement)) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [mood, stage, size]);

  return <div ref={mountRef} style={{ width: size, height: size }} />;
}
