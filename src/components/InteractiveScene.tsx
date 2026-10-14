"use client";

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";

export const InteractiveScene: React.FC = () => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [isSupported, setIsSupported] = useState(true);

  useEffect(() => {
    // Check for reduced motion preference
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mediaQuery.matches) {
      setIsSupported(false);
      return;
    }

    const container = mountRef.current;
    if (!container) return;

    let scene: THREE.Scene;
    let camera: THREE.PerspectiveCamera;
    let renderer: THREE.WebGLRenderer;
    let particlesMesh: THREE.Points;
    let animationFrameId: number;

    try {
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(
        60,
        container.clientWidth / container.clientHeight,
        0.1,
        100
      );
      camera.position.z = 25;

      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      container.appendChild(renderer.domElement);

      // Create botanical gold & sage glowing particles
      const particleCount = window.innerWidth < 768 ? 60 : 130;
      const positions = new Float32Array(particleCount * 3);
      const colors = new Float32Array(particleCount * 3);
      const scales = new Float32Array(particleCount);

      const colorPalette = [
        new THREE.Color("#B58A57"), // Brass gold
        new THREE.Color("#A8B79A"), // Sage
        new THREE.Color("#F4F0E5"), // Cream
        new THREE.Color("#C89F6B"), // Warm light gold
      ];

      for (let i = 0; i < particleCount; i++) {
        // Distribute in a wide ellipse
        positions[i * 3] = (Math.random() - 0.5) * 45;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 35;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 20;

        const pickedColor = colorPalette[Math.floor(Math.random() * colorPalette.length)];
        colors[i * 3] = pickedColor.r;
        colors[i * 3 + 1] = pickedColor.g;
        colors[i * 3 + 2] = pickedColor.b;

        scales[i] = Math.random() * 0.8 + 0.4;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

      // Particle texture via soft circle
      const canvas = document.createElement("canvas");
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        gradient.addColorStop(0, "rgba(255, 255, 255, 0.9)");
        gradient.addColorStop(0.3, "rgba(255, 255, 255, 0.6)");
        gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 32, 32);
      }
      const particleTexture = new THREE.CanvasTexture(canvas);

      const material = new THREE.PointsMaterial({
        size: 0.6,
        vertexColors: true,
        transparent: true,
        opacity: 0.7,
        map: particleTexture,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

      particlesMesh = new THREE.Points(geometry, material);
      scene.add(particlesMesh);

      // Subtle mouse interaction
      let mouseX = 0;
      let mouseY = 0;
      let targetX = 0;
      let targetY = 0;

      const handlePointerMove = (e: MouseEvent) => {
        targetX = (e.clientX / window.innerWidth - 0.5) * 2;
        targetY = (e.clientY / window.innerHeight - 0.5) * 2;
      };

      window.addEventListener("mousemove", handlePointerMove, { passive: true });

      // Resize listener
      const handleResize = () => {
        if (!container) return;
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
      };

      window.addEventListener("resize", handleResize);

      // Render loop
      let clock = new THREE.Clock();

      const animate = () => {
        animationFrameId = requestAnimationFrame(animate);
        const elapsedTime = clock.getElapsedTime();

        // Smooth mouse lerping
        mouseX += (targetX - mouseX) * 0.04;
        mouseY += (targetY - mouseY) * 0.04;

        if (particlesMesh) {
          particlesMesh.rotation.y = elapsedTime * 0.03 + mouseX * 0.2;
          particlesMesh.rotation.x = Math.sin(elapsedTime * 0.02) * 0.1 - mouseY * 0.15;
          particlesMesh.position.y = Math.sin(elapsedTime * 0.5) * 0.4;
        }

        renderer.render(scene, camera);
      };

      animate();

      return () => {
        cancelAnimationFrame(animationFrameId);
        window.removeEventListener("mousemove", handlePointerMove);
        window.removeEventListener("resize", handleResize);
        if (container && renderer.domElement && container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
        geometry.dispose();
        material.dispose();
        particleTexture.dispose();
        renderer.dispose();
      };
    } catch {
      setIsSupported(false);
    }
  }, []);

  if (!isSupported) {
    return (
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,rgba(181,138,87,0.15),transparent_60%)]" />
    );
  }

  return (
    <div
      ref={mountRef}
      className="absolute inset-0 pointer-events-none z-10 overflow-hidden mix-blend-screen opacity-70"
      aria-hidden="true"
    />
  );
};
