'use client';

/**
 * Blink Detection Hook using MediaPipe Face Mesh
 *
 * Uses Eye Aspect Ratio (EAR) algorithm to detect blinks:
 * - EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)
 * - When EAR drops below threshold, eye is closed
 * - Blink = eye closes then opens within time window
 *
 * Debouncing: 200ms minimum between blinks to avoid false positives
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerResult,
} from '@mediapipe/tasks-vision';

// Eye landmark indices for MediaPipe Face Mesh (6-point EAR)
const LEFT_EYE = {
  p1: 33, // outer corner
  p2: 160, // upper lid outer
  p3: 158, // upper lid inner
  p4: 133, // inner corner
  p5: 153, // lower lid inner
  p6: 144, // lower lid outer
};

const RIGHT_EYE = {
  p1: 362, // outer corner
  p2: 385, // upper lid outer
  p3: 387, // upper lid inner
  p4: 263, // inner corner
  p5: 373, // lower lid inner
  p6: 380, // lower lid outer
};

// Full eye contour indices for drawing
const LEFT_EYE_CONTOUR = [
  33, 246, 161, 160, 159, 158, 157, 173, 133, // upper
  133, 155, 154, 153, 145, 144, 163, 7, 33,    // lower
];

const RIGHT_EYE_CONTOUR = [
  362, 398, 384, 385, 386, 387, 388, 466, 263, // upper
  263, 249, 390, 373, 374, 380, 381, 382, 362, // lower
];

// Iris landmarks (MediaPipe provides these with face mesh)
const LEFT_IRIS = [468, 469, 470, 471, 472];
const RIGHT_IRIS = [473, 474, 475, 476, 477];

// Detection parameters
const EAR_THRESHOLD = 0.21; // Below this = eye closed
const BLINK_DEBOUNCE_MS = 200; // Min time between blinks
const CONSECUTIVE_FRAMES = 2; // Frames eye must be closed

interface BlinkDetectionConfig {
  earThreshold?: number;
  debounceMs?: number;
  consecutiveFrames?: number;
  enabled?: boolean;
}

interface BlinkDetectionResult {
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  isReady: boolean;
  isRunning: boolean;
  blinkCount: number;
  currentEAR: number;
  fps: number;
  start: () => Promise<void>;
  stop: () => void;
  reset: () => void;
}

function calculateEAR(
  landmarks: { x: number; y: number; z: number }[],
  eye: typeof LEFT_EYE
): number {
  const p1 = landmarks[eye.p1];
  const p2 = landmarks[eye.p2];
  const p3 = landmarks[eye.p3];
  const p4 = landmarks[eye.p4];
  const p5 = landmarks[eye.p5];
  const p6 = landmarks[eye.p6];

  // Euclidean distances
  const vertical1 = Math.sqrt(
    Math.pow(p2.x - p6.x, 2) + Math.pow(p2.y - p6.y, 2)
  );
  const vertical2 = Math.sqrt(
    Math.pow(p3.x - p5.x, 2) + Math.pow(p3.y - p5.y, 2)
  );
  const horizontal = Math.sqrt(
    Math.pow(p1.x - p4.x, 2) + Math.pow(p1.y - p4.y, 2)
  );

  // EAR formula
  return (vertical1 + vertical2) / (2.0 * horizontal);
}

/**
 * Draw eye tracking overlay on canvas
 */
function drawEyeTracking(
  ctx: CanvasRenderingContext2D,
  landmarks: { x: number; y: number; z: number }[],
  width: number,
  height: number,
  leftEAR: number,
  rightEAR: number,
  earThreshold: number,
  blinkFlash: boolean,
) {
  ctx.clearRect(0, 0, width, height);

  // Blink flash effect
  if (blinkFlash) {
    ctx.fillStyle = 'rgba(0, 255, 136, 0.12)';
    ctx.fillRect(0, 0, width, height);
  }

  // Flip x so landmarks match the CSS-mirrored video (canvas is NOT CSS-mirrored)
  const toPixel = (lm: { x: number; y: number }) => ({
    x: (1 - lm.x) * width,
    y: lm.y * height,
  });

  // --- Draw eye contours ---
  const drawContour = (indices: number[], color: string, glowColor: string) => {
    if (indices.length < 2) return;

    ctx.shadowBlur = 0;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const first = toPixel(landmarks[indices[0]]);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < indices.length; i++) {
      const pt = toPixel(landmarks[indices[i]]);
      ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();

    // Reset shadow
    ctx.shadowBlur = 0;
  };

  const eyeColor = blinkFlash ? 'rgba(0, 255, 136, 0.9)' : 'rgba(0, 200, 255, 0.7)';
  const glowCol = blinkFlash ? 'rgba(0, 255, 136, 0.6)' : 'rgba(0, 200, 255, 0.4)';

  drawContour(LEFT_EYE_CONTOUR, eyeColor, glowCol);
  drawContour(RIGHT_EYE_CONTOUR, eyeColor, glowCol);

  // --- Draw EAR measurement lines (the 6 points) ---
  const drawEARPoints = (eye: typeof LEFT_EYE, ear: number) => {
    const points = [eye.p1, eye.p2, eye.p3, eye.p4, eye.p5, eye.p6];

    // Draw vertical measurement lines (p2-p6 and p3-p5)
    ctx.strokeStyle = 'rgba(255, 255, 0, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);

    const p2 = toPixel(landmarks[eye.p2]);
    const p6 = toPixel(landmarks[eye.p6]);
    ctx.beginPath();
    ctx.moveTo(p2.x, p2.y);
    ctx.lineTo(p6.x, p6.y);
    ctx.stroke();

    const p3 = toPixel(landmarks[eye.p3]);
    const p5 = toPixel(landmarks[eye.p5]);
    ctx.beginPath();
    ctx.moveTo(p3.x, p3.y);
    ctx.lineTo(p5.x, p5.y);
    ctx.stroke();

    // Horizontal line (p1-p4)
    const p1 = toPixel(landmarks[eye.p1]);
    const p4 = toPixel(landmarks[eye.p4]);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p4.x, p4.y);
    ctx.stroke();

    ctx.setLineDash([]);

    // Draw landmark dots
    for (const idx of points) {
      const pt = toPixel(landmarks[idx]);
      ctx.fillStyle = 'rgba(255, 255, 0, 0.9)';
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  };

  drawEARPoints(LEFT_EYE, leftEAR);
  drawEARPoints(RIGHT_EYE, rightEAR);

  // --- Draw iris circles ---
  const drawIris = (irisIndices: number[]) => {
    if (irisIndices.length < 5 || !landmarks[irisIndices[0]]) return;

    // Center point
    const center = toPixel(landmarks[irisIndices[0]]);

    // Calculate radius from surrounding points
    let radius = 0;
    for (let i = 1; i < irisIndices.length; i++) {
      const pt = toPixel(landmarks[irisIndices[i]]);
      const dx = pt.x - center.x;
      const dy = pt.y - center.y;
      radius += Math.sqrt(dx * dx + dy * dy);
    }
    radius /= (irisIndices.length - 1);

    // Iris circle
    ctx.strokeStyle = blinkFlash ? 'rgba(0, 255, 136, 0.6)' : 'rgba(0, 200, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Center dot
    ctx.fillStyle = blinkFlash ? 'rgba(0, 255, 136, 0.8)' : 'rgba(0, 200, 255, 0.7)';
    ctx.beginPath();
    ctx.arc(center.x, center.y, 2, 0, Math.PI * 2);
    ctx.fill();
  };

  drawIris(LEFT_IRIS);
  drawIris(RIGHT_IRIS);

  // --- Draw EAR values near each eye ---
  const leftCenter = toPixel(landmarks[LEFT_EYE.p4]); // inner corner of left eye
  const rightCenter = toPixel(landmarks[RIGHT_EYE.p1]); // outer corner of right eye

  ctx.font = '11px "SF Mono", Monaco, monospace';
  ctx.textAlign = 'center';

  // Left eye EAR
  const leftColor = leftEAR < earThreshold ? 'rgba(255, 80, 80, 0.9)' : 'rgba(0, 255, 136, 0.9)';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(leftCenter.x - 30, leftCenter.y + 12, 60, 16);
  ctx.fillStyle = leftColor;
  ctx.fillText(`EAR ${leftEAR.toFixed(2)}`, leftCenter.x, leftCenter.y + 24);

  // Right eye EAR
  const rightColor = rightEAR < earThreshold ? 'rgba(255, 80, 80, 0.9)' : 'rgba(0, 255, 136, 0.9)';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(rightCenter.x - 30, rightCenter.y + 12, 60, 16);
  ctx.fillStyle = rightColor;
  ctx.fillText(`EAR ${rightEAR.toFixed(2)}`, rightCenter.x, rightCenter.y + 24);

  // --- BLINK detected label ---
  if (blinkFlash) {
    ctx.font = 'bold 18px "SF Mono", Monaco, monospace';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0, 255, 136, 1)';

    // Position between the two eyes
    const midX = (toPixel(landmarks[LEFT_EYE.p4]).x + toPixel(landmarks[RIGHT_EYE.p1]).x) / 2;
    const midY = Math.min(toPixel(landmarks[LEFT_EYE.p2]).y, toPixel(landmarks[RIGHT_EYE.p2]).y) - 20;
    ctx.fillText('BLINK', midX, midY);
    ctx.shadowBlur = 0;
  }
}

export function useBlinkDetection(
  onBlink: (count: number) => void,
  config: BlinkDetectionConfig = {}
): BlinkDetectionResult {
  const {
    earThreshold = EAR_THRESHOLD,
    debounceMs = BLINK_DEBOUNCE_MS,
    consecutiveFrames = CONSECUTIVE_FRAMES,
    enabled = true,
  } = config;

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const animationFrameRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [blinkCount, setBlinkCount] = useState(0);
  const [currentEAR, setCurrentEAR] = useState(0);
  const [fps, setFps] = useState(0);

  // Blink detection state
  const eyeClosedFramesRef = useRef(0);
  const wasBlinkingRef = useRef(false);
  const lastBlinkTimeRef = useRef(0);
  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(Date.now());
  const blinkCountRef = useRef(0);
  const blinkFlashRef = useRef(0); // timestamp of last blink for flash effect
  
  // Keep latest onBlink in a ref so the animation loop always calls the current version
  const onBlinkRef = useRef(onBlink);
  onBlinkRef.current = onBlink;

  // Initialize MediaPipe Face Landmarker
  useEffect(() => {
    async function init() {
      try {
        console.log('Loading MediaPipe vision tasks (local)...');
        
        // Use local WASM files to avoid CDN SSL issues
        const vision = await FilesetResolver.forVisionTasks(
          '/mediapipe/wasm'
        );

        console.log('Creating FaceLandmarker...');
        
        const landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            // Use local model file
            modelAssetPath: '/mediapipe/face_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        });

        console.log('FaceLandmarker ready!');
        faceLandmarkerRef.current = landmarker;
        setIsReady(true);
      } catch (err) {
        console.error('Failed to initialize Face Landmarker:', err);
        
        // Try fallback with CPU delegate
        try {
          console.log('Retrying with CPU delegate...');
          const vision = await FilesetResolver.forVisionTasks(
            '/mediapipe/wasm'
          );

          const landmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: '/mediapipe/face_landmarker.task',
              delegate: 'CPU',
            },
            runningMode: 'VIDEO',
            numFaces: 1,
            outputFaceBlendshapes: false,
            outputFacialTransformationMatrixes: false,
          });

          console.log('FaceLandmarker ready (CPU mode)!');
          faceLandmarkerRef.current = landmarker;
          setIsReady(true);
        } catch (fallbackErr) {
          console.error('Fallback also failed:', fallbackErr);
        }
      }
    }

    init();

    return () => {
      faceLandmarkerRef.current?.close();
    };
  }, []);

  // Process video frame
  const processFrame = useCallback(() => {
    const video = videoRef.current;
    const landmarker = faceLandmarkerRef.current;

    if (!video || !landmarker || video.readyState !== 4) {
      animationFrameRef.current = requestAnimationFrame(processFrame);
      return;
    }

    const startTime = performance.now();
    const result = landmarker.detectForVideo(video, startTime);

    // Calculate FPS
    frameCountRef.current++;
    const now = Date.now();
    if (now - lastFpsTimeRef.current >= 1000) {
      setFps(frameCountRef.current);
      frameCountRef.current = 0;
      lastFpsTimeRef.current = now;
    }

    // Log once to confirm this code version is running
    if (frameCountRef.current === 1) {
      console.log('[EyeTracking] CODE V3 running | canvasRef.current:', canvasRef.current, '| videoRef.current:', videoRef.current);
    }

    if (result.faceLandmarks && result.faceLandmarks.length > 0) {
      const landmarks = result.faceLandmarks[0];

      // Calculate EAR for both eyes
      const leftEAR = calculateEAR(landmarks, LEFT_EYE);
      const rightEAR = calculateEAR(landmarks, RIGHT_EYE);
      const avgEAR = (leftEAR + rightEAR) / 2;

      setCurrentEAR(avgEAR);

      // Blink detection logic
      const eyesClosed = avgEAR < earThreshold;

      if (eyesClosed) {
        eyeClosedFramesRef.current++;

        // Mark as blinking if eyes closed for enough frames
        if (eyeClosedFramesRef.current >= consecutiveFrames) {
          wasBlinkingRef.current = true;
        }
      } else {
        // Eyes opened - check if this completes a blink
        if (wasBlinkingRef.current) {
          const timeSinceLastBlink = now - lastBlinkTimeRef.current;

          // Debounce check — only count if enabled (user connected)
          if (timeSinceLastBlink >= debounceMs && enabledRef.current) {
            blinkCountRef.current++;
            setBlinkCount(blinkCountRef.current);
            lastBlinkTimeRef.current = now;
            blinkFlashRef.current = now;
            onBlinkRef.current(blinkCountRef.current);
          }
        }

        // Reset state
        eyeClosedFramesRef.current = 0;
        wasBlinkingRef.current = false;
      }

      // Draw eye tracking overlay on canvas
      const canvas = canvasRef.current;
      if (canvas && video) {
        // Match canvas drawing buffer to video display size
        const rect = video.getBoundingClientRect();
        const w = Math.round(rect.width);
        const h = Math.round(rect.height);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
          console.log(`[EyeTracking] Canvas resized to ${w}x${h}`);
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Flash lasts 300ms after blink
          const showFlash = now - blinkFlashRef.current < 300;
          drawEyeTracking(
            ctx,
            landmarks,
            w,
            h,
            leftEAR,
            rightEAR,
            earThreshold,
            showFlash,
          );
        }
      } else {
        // Log every second when canvas is missing to help debug
        if (frameCountRef.current <= 3) {
          console.warn('[EyeTracking] Canvas ref is NULL! canvasRef:', canvasRef, 'canvasRef.current:', canvasRef.current);
        }
      }
    } else {
      // No face detected - clear canvas
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }

    animationFrameRef.current = requestAnimationFrame(processFrame);
  }, [earThreshold, consecutiveFrames, debounceMs]);

  // Start detection
  const start = useCallback(async () => {
    if (!videoRef.current || !faceLandmarkerRef.current) {
      throw new Error('Not ready');
    }

    try {
      // Use lower resolution on mobile for better MediaPipe performance
      const isMobileDevice = window.innerWidth <= 768
        || ('ontouchstart' in window && window.innerWidth <= 1024);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: isMobileDevice ? 480 : 640 },
          height: { ideal: isMobileDevice ? 360 : 480 },
          facingMode: 'user',
          frameRate: { ideal: isMobileDevice ? 24 : 30 },
        },
      });

      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      // Reset counters
      blinkCountRef.current = 0;
      setBlinkCount(0);
      eyeClosedFramesRef.current = 0;
      wasBlinkingRef.current = false;
      lastBlinkTimeRef.current = 0;

      setIsRunning(true);
      processFrame();
    } catch (err) {
      console.error('Failed to start camera:', err);
      throw err;
    }
  }, [processFrame]);

  // Stop detection
  const stop = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsRunning(false);
  }, []);

  // Reset blink count
  const reset = useCallback(() => {
    blinkCountRef.current = 0;
    setBlinkCount(0);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    videoRef,
    canvasRef,
    isReady,
    isRunning,
    blinkCount,
    currentEAR,
    fps,
    start,
    stop,
    reset,
  };
}
