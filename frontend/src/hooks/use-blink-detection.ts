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

// Eye landmark indices for MediaPipe Face Mesh
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

// Detection parameters
const EAR_THRESHOLD = 0.21; // Below this = eye closed
const BLINK_DEBOUNCE_MS = 200; // Min time between blinks
const CONSECUTIVE_FRAMES = 2; // Frames eye must be closed

interface BlinkDetectionConfig {
  earThreshold?: number;
  debounceMs?: number;
  consecutiveFrames?: number;
}

interface BlinkDetectionResult {
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
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

export function useBlinkDetection(
  onBlink: (count: number) => void,
  config: BlinkDetectionConfig = {}
): BlinkDetectionResult {
  const {
    earThreshold = EAR_THRESHOLD,
    debounceMs = BLINK_DEBOUNCE_MS,
    consecutiveFrames = CONSECUTIVE_FRAMES,
  } = config;

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
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

          // Debounce check
          if (timeSinceLastBlink >= debounceMs) {
            blinkCountRef.current++;
            setBlinkCount(blinkCountRef.current);
            lastBlinkTimeRef.current = now;
            onBlinkRef.current(blinkCountRef.current);
          }
        }

        // Reset state
        eyeClosedFramesRef.current = 0;
        wasBlinkingRef.current = false;
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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
          frameRate: { ideal: 30 },
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
