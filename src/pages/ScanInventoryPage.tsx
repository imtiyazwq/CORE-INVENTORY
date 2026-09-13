import React, { useState, useRef, useEffect } from 'react';
import {
  Camera,
  Upload,
  Play,
  Square,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Layers,
  Cpu,
  Plus,
  Minus,
  Trash2,
  ChevronDown,
  Check,
  Activity,
  Sliders,
} from 'lucide-react';
import {
  DetectedObject,
  ValidLocation,
  ModelConfig,
  UserAccount,
  PipelineDiagnostics,
} from '../types';
import { VALID_LOCATIONS } from '../data/locations';
import { decodeImageFile, DecodedImageResult } from '../services/imageDecoder';
import { modelService, runDetection, DEFAULT_YOLO_LABELS } from '../services/modelService';
import { DiagnosticsPanel } from '../components/DiagnosticsPanel';
import { BoundingBoxOverlay } from '../components/BoundingBoxOverlay';

interface ScanInventoryPageProps {
  onScanConfirmed: (scanData: {
    location: ValidLocation;
    confirmedItems: Array<{ className: string; quantity: number; confidence: number; sku: string | null }>;
    operator: string;
    team?: string;
    notes: string;
    type: 'webcam' | 'upload';
    previewUrl?: string;
  }) => void;
  defaultLocation?: ValidLocation;
  initialMode?: 'webcam' | 'upload';
  currentUser?: UserAccount | null;
}

interface ConfirmedItemRow {
  className: string;
  category: string;
  quantity: number;
  confidence: number;
  isManual?: boolean;
  // Real product SKU resolved from DEFAULT_YOLO_LABELS at detection/add time.
  // null means this class has no product mapping (see yoloConfig.ts's
  // YOLO_CLASS_SKUS) — it must not be posted as a transaction.
  sku: string | null;
}

export const ScanInventoryPage: React.FC<ScanInventoryPageProps> = ({
  onScanConfirmed,
  defaultLocation = VALID_LOCATIONS[0],
  initialMode = 'webcam',
  currentUser,
}) => {
  // 1. Navigation & Mode Tabs: 'webcam' | 'upload'
  const [activeTab, setActiveTab] = useState<'webcam' | 'upload'>(initialMode);

  // 2. Location & Rack/Shelf Controls
  const [selectedLocation, setSelectedLocation] = useState<ValidLocation>(defaultLocation);
  const [rackShelf, setRackShelf] = useState<string>('Rack 1 - Shelf A');

  // 3. Model Configuration & Diagnostics
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0.5);
  const [nmsThreshold, setNmsThreshold] = useState<number>(0.45);
  const [modelConfig, setModelConfig] = useState<ModelConfig>(modelService.getConfig());
  const [diagnostics, setDiagnostics] = useState<PipelineDiagnostics | null>(null);

  // 4. Webcam Detection States
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [fps, setFps] = useState<number>(0);
  const [webcamDetectedObjects, setWebcamDetectedObjects] = useState<DetectedObject[]>([]);
  const [webcamInferenceTime, setWebcamInferenceTime] = useState<number>(0);

  // 5. Image Upload States
  const [uploadedResult, setUploadedResult] = useState<DecodedImageResult | null>(null);
  const [isDecoding, setIsDecoding] = useState<boolean>(false);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [isProcessingModel, setIsProcessingModel] = useState<boolean>(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelState, setModelState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);
  const [hasRunInference, setHasRunInference] = useState<boolean>(false);
  const [uploadDetectedObjects, setUploadDetectedObjects] = useState<DetectedObject[]>([]);
  const [uploadInferenceTime, setUploadInferenceTime] = useState<number>(0);

  // 6. Right Panel: Detection Confirmation Items
  const [confirmedItems, setConfirmedItems] = useState<ConfirmedItemRow[]>([]);
  const [operator, setOperator] = useState<string>(currentUser?.userName || 'John Smith');
  const [notes, setNotes] = useState<string>('');
  const [showManualAddSelect, setShowManualAddSelect] = useState<boolean>(false);
  const [manualSelectClass, setManualSelectClass] = useState<string>(DEFAULT_YOLO_LABELS[0].label);
  const [confirmSuccessMessage, setConfirmSuccessMessage] = useState<string | null>(null);

  // DOM Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const webcamContainerRef = useRef<HTMLDivElement | null>(null);
  const uploadContainerRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isCameraActiveRef = useRef<boolean>(false);
  const webcamAnimationRef = useRef<number | null>(null);
  const isWebcamBusyRef = useRef<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastFpsTimeRef = useRef<number>(performance.now());
  const frameCountRef = useRef<number>(0);

  // Pre-load the real TFLite model on mount
  useEffect(() => {
    let isMounted = true;
    const initModel = async () => {
      setModelState('loading');
      setModelLoadError(null);
      try {
        await modelService.loadModel();
        if (isMounted) {
          setModelState('ready');
          setModelLoadError(null);
        }
      } catch (err: any) {
        if (isMounted) {
          setModelState('error');
          const msg = err instanceof Error ? err.message : String(err);
          setModelLoadError(`Unable to load or run the TFLite model: ${msg}`);
          console.error('[ScanInventoryPage] Model load failure:', err);
        }
      }
    };
    initModel();
    return () => {
      isMounted = false;
    };
  }, []);

  // Sync initialMode on mount
  useEffect(() => {
    if (initialMode) {
      setActiveTab(initialMode);
    }
  }, [initialMode]);

  // Clean up webcam stream on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Update model service confidence threshold
  const handleConfidenceChange = (val: number) => {
    setConfidenceThreshold(val);
    modelService.updateConfig({ confidenceThreshold: val });
    setModelConfig(modelService.getConfig());
  };

  // Update model service NMS threshold
  const handleNmsChange = (val: number) => {
    setNmsThreshold(val);
    modelService.updateConfig({ nmsThreshold: val });
    setModelConfig(modelService.getConfig());
  };

  // --- WEBCAM MANAGEMENT ---

  const startCamera = async () => {
    setCameraError(null);
    setConfirmSuccessMessage(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API (getUserMedia) is not supported in this browser environment.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'environment',
        },
        audio: false,
      });

      streamRef.current = stream;
      isCameraActiveRef.current = true;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch {
          // Autoplay fallback
        }
      }

      setIsCameraActive(true);
      startWebcamDetectionLoop();
    } catch (err: any) {
      console.error('[Webcam] Error accessing camera:', err);
      let msg = 'Failed to access camera.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = 'Camera permission was denied. Please allow camera access in browser settings.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        msg = 'No video camera detected on this device.';
      } else if (err.name === 'NotReadableError') {
        msg = 'Camera is already in use by another application.';
      } else {
        msg = err.message || 'Unable to open camera stream.';
      }
      setCameraError(msg);
      setIsCameraActive(false);
      isCameraActiveRef.current = false;
    }
  };

  const stopCamera = () => {
    isCameraActiveRef.current = false;
    if (webcamAnimationRef.current) {
      cancelAnimationFrame(webcamAnimationRef.current);
      webcamAnimationRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
    setWebcamDetectedObjects([]);
  };

  const startWebcamDetectionLoop = () => {
    const loop = async () => {
      if (!isCameraActiveRef.current) return;

      if (!videoRef.current || videoRef.current.readyState < 2 || !streamRef.current) {
        webcamAnimationRef.current = requestAnimationFrame(loop);
        return;
      }

      // FPS measurement
      frameCountRef.current++;
      const now = performance.now();
      if (now - lastFpsTimeRef.current >= 1000) {
        setFps(Math.round((frameCountRef.current * 1000) / (now - lastFpsTimeRef.current)));
        frameCountRef.current = 0;
        lastFpsTimeRef.current = now;
      }

      if (!isWebcamBusyRef.current && videoRef.current) {
        isWebcamBusyRef.current = true;
        try {
          const result = await runDetection(videoRef.current);
          setWebcamDetectedObjects(result.objects);
          setWebcamInferenceTime(result.diagnostics.totalTimeMs);
          setDiagnostics(result.diagnostics);

          // Update confirmation items strictly from post-NMS summary
          if (result.summary.length > 0) {
            setConfirmedItems((prev) => {
              const manualItems = prev.filter((it) => it.isManual);
              const detectedMap = new Map<string, ConfirmedItemRow>();

              result.summary.forEach((item) => {
                const labelMeta = DEFAULT_YOLO_LABELS.find((l) => l.label === item.className);
                detectedMap.set(item.className, {
                  className: item.className,
                  category: labelMeta?.category || 'General Equipment',
                  quantity: item.count,
                  confidence: item.averageConfidence,
                  isManual: false,
                  sku: labelMeta?.sku ?? null,
                });
              });

              manualItems.forEach((m) => {
                if (!detectedMap.has(m.className)) {
                  detectedMap.set(m.className, m);
                }
              });

              return Array.from(detectedMap.values());
            });
          }
        } catch (err: any) {
          console.warn('[Webcam] Inference iteration note:', err.message);
        } finally {
          isWebcamBusyRef.current = false;
        }
      }

      // Smooth throttle (~12-15 FPS inference cycle)
      setTimeout(() => {
        if (isCameraActiveRef.current) {
          webcamAnimationRef.current = requestAnimationFrame(loop);
        }
      }, 70);
    };

    webcamAnimationRef.current = requestAnimationFrame(loop);
  };

  // --- IMAGE UPLOAD MANAGEMENT ---

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    await processUploadedFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processUploadedFile(e.dataTransfer.files[0]);
    }
  };

  const processUploadedFile = async (file: File) => {
    setIsDecoding(true);
    setDecodeError(null);
    setModelError(null);
    setUploadDetectedObjects([]);
    setUploadedResult(null);
    setConfirmSuccessMessage(null);

    try {
      const decoded = await decodeImageFile(file);
      setUploadedResult(decoded);
      setIsDecoding(false);

      // Run real YOLO TFLite inference
      await runYOLOOnCanvas(decoded.canvas);
    } catch (err: any) {
      setIsDecoding(false);
      console.error('[Upload] Image Decoding Failure:', err);
      setDecodeError(err.message || 'Unable to decode image file.');
    }
  };

  const runYOLOOnCanvas = async (canvas: HTMLCanvasElement) => {
    setIsProcessingModel(true);
    setModelError(null);
    try {
      const result = await runDetection(canvas);
      setUploadDetectedObjects(result.objects);
      setUploadInferenceTime(result.diagnostics.totalTimeMs);
      setDiagnostics(result.diagnostics);

      // Populate confirmation items strictly from post-NMS results
      const newItems: ConfirmedItemRow[] = result.summary.map((item) => {
        const labelMeta = DEFAULT_YOLO_LABELS.find((l) => l.label === item.className);
        return {
          className: item.className,
          category: labelMeta?.category || 'General Equipment',
          quantity: item.count,
          confidence: item.averageConfidence,
          isManual: false,
          sku: labelMeta?.sku ?? null,
        };
      });

      setConfirmedItems(newItems);
    } catch (err: any) {
      console.error('[Upload] Model Evaluation Error:', err);
      setModelError(err.message || 'Unable to evaluate TFLite model.');
    } finally {
      setIsProcessingModel(false);
    }
  };

  // --- CONFIRMATION ITEM HANDLERS ---

  const handleQuantityChange = (className: string, delta: number) => {
    setConfirmedItems((prev) =>
      prev.map((item) => {
        if (item.className === className) {
          const newQty = Math.max(0, item.quantity + delta);
          return { ...item, quantity: newQty };
        }
        return item;
      })
    );
  };

  const handleRemoveItem = (className: string) => {
    setConfirmedItems((prev) => prev.filter((item) => item.className !== className));
  };

  const handleAddManualItem = () => {
    const existing = confirmedItems.find((it) => it.className === manualSelectClass);
    if (existing) {
      handleQuantityChange(manualSelectClass, 1);
    } else {
      const labelMeta = DEFAULT_YOLO_LABELS.find((l) => l.label === manualSelectClass);
      setConfirmedItems((prev) => [
        ...prev,
        {
          className: manualSelectClass,
          category: labelMeta?.category || 'General Equipment',
          quantity: 1,
          confidence: 1.0,
          isManual: true,
          sku: labelMeta?.sku ?? null,
        },
      ]);
    }
    setShowManualAddSelect(false);
  };

  const totalConfirmedUnits = confirmedItems.reduce((acc, curr) => acc + curr.quantity, 0);

  const handleFinalConfirm = () => {
    if (confirmedItems.length === 0 || totalConfirmedUnits === 0) return;

    onScanConfirmed({
      location: selectedLocation,
      confirmedItems: confirmedItems.map((it) => ({
        className: it.className,
        quantity: it.quantity,
        confidence: it.confidence,
        sku: it.sku,
      })),
      operator: operator.trim() || currentUser?.userName || 'John Smith',
      team: currentUser?.teamName,
      notes: notes.trim() || `${activeTab === 'webcam' ? 'Live Webcam' : 'Image Upload'} scan at ${rackShelf}`,
      type: activeTab,
      previewUrl: uploadedResult?.dataUrl,
    });

    // Submitted for processing — App.tsx's toast (after the async transaction
    // calls resolve) is the authoritative success/failure report, since not
    // every item here is guaranteed to have a resolvable product SKU.
    setConfirmSuccessMessage(
      `Submitted ${totalConfirmedUnits} units across ${confirmedItems.length} items at ${selectedLocation} (${rackShelf}) for processing — see the confirmation notice.`
    );

    setTimeout(() => {
      setConfirmSuccessMessage(null);
    }, 6000);
  };

  // Seamless tab switch without tearing or DOM remount glitches
  const handleTabSwitch = (tab: 'webcam' | 'upload') => {
    if (tab === activeTab) return;
    setActiveTab(tab);
    setConfirmSuccessMessage(null);
    if (tab === 'upload') {
      if (isCameraActiveRef.current) {
        stopCamera();
      }
    }
  };

  return (
    <div className="space-y-5 pb-12">
      {/* ========================================================================= */}
      {/* 1. TOP BAR: MODE SELECTOR TABS & LOCATION / RACK / SETTINGS CONTROLS      */}
      {/* ========================================================================= */}
      <div className="bg-white rounded-xl border border-slate-200/90 p-3 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Left Side: Segmented Mode Selector Tab Pill */}
        <div
          role="tablist"
          className="inline-flex p-1 bg-slate-100 rounded-lg border border-slate-200/80 self-start"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'webcam'}
            id="tab-webcam-detection"
            onClick={() => handleTabSwitch('webcam')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer select-none outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#005f60]/30 border ${
              activeTab === 'webcam'
                ? 'bg-white text-slate-900 font-semibold border-slate-200/90 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 border-transparent hover:bg-slate-200/50'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                activeTab === 'webcam' ? 'bg-[#005f60]' : 'bg-transparent'
              }`}
            />
            <Camera
              className={`w-3.5 h-3.5 ${activeTab === 'webcam' ? 'text-[#005f60]' : 'text-slate-400'}`}
            />
            <span>Live Webcam</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'upload'}
            id="tab-upload-image"
            onClick={() => handleTabSwitch('upload')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer select-none outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-[#005f60]/30 border ${
              activeTab === 'upload'
                ? 'bg-white text-slate-900 font-semibold border-slate-200/90 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 border-transparent hover:bg-slate-200/50'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                activeTab === 'upload' ? 'bg-[#005f60]' : 'bg-transparent'
              }`}
            />
            <Upload
              className={`w-3.5 h-3.5 ${activeTab === 'upload' ? 'text-[#005f60]' : 'text-slate-400'}`}
            />
            <span>Upload Image</span>
          </button>
        </div>

        {/* Center: Model Lifecycle Status Badge */}
        <div className="flex items-center gap-2">
          {modelState === 'loading' && (
            <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200 flex items-center gap-1.5 shadow-2xs">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-600" />
              <span>Loading AI model...</span>
            </span>
          )}
          {modelState === 'ready' && !isProcessingModel && (
            <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center gap-1.5 shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span>Model ready</span>
            </span>
          )}
          {isProcessingModel && (
            <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-teal-50 text-teal-800 border border-teal-200 flex items-center gap-1.5 shadow-2xs animate-pulse">
              <Cpu className="w-3.5 h-3.5 text-[#005f60]" />
              <span>Analyzing image...</span>
            </span>
          )}
          {modelState === 'error' && (
            <span
              className="px-2.5 py-1 rounded-md text-xs font-medium bg-rose-50 text-rose-800 border border-rose-200 flex items-center gap-1.5 shadow-2xs"
              title={modelLoadError || ''}
            >
              <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
              <span>Unable to load or run the TFLite model</span>
            </span>
          )}
        </div>

        {/* Right Side: Location, Rack/Shelf, and Confidence Threshold Controls */}
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          {/* Location Dropdown */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="scan-location-select" className="text-slate-600 font-medium">
              Location:
            </label>
            <div className="relative">
              <select
                id="scan-location-select"
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value as ValidLocation)}
                className="text-xs font-medium px-2.5 py-1.5 pr-7 rounded-lg border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-[#005f60] appearance-none shadow-2xs cursor-pointer min-w-[150px]"
              >
                {VALID_LOCATIONS.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-2 pointer-events-none" />
            </div>
          </div>

          {/* Rack/Shelf Input */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="scan-rackshelf-input" className="text-slate-600 font-medium">
              Rack/Shelf:
            </label>
            <input
              id="scan-rackshelf-input"
              type="text"
              value={rackShelf}
              onChange={(e) => setRackShelf(e.target.value)}
              placeholder="Rack 1 - Shelf A"
              className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-[#005f60] shadow-2xs w-36"
            />
          </div>

          {/* Confidence Threshold Selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium">Confidence:</span>
            <div className="relative">
              <select
                value={confidenceThreshold}
                onChange={(e) => handleConfidenceChange(parseFloat(e.target.value))}
                className="text-xs font-medium font-mono px-2.5 py-1.5 pr-6 rounded-lg border border-slate-200 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#005f60] appearance-none shadow-2xs cursor-pointer"
                title="Confidence Threshold"
              >
                <option value={0.3}>30%</option>
                <option value={0.4}>40%</option>
                <option value={0.5}>50%</option>
                <option value={0.6}>60%</option>
                <option value={0.7}>70%</option>
                <option value={0.8}>80%</option>
                <option value={0.9}>90%</option>
              </select>
              <ChevronDown className="w-3 h-3 text-slate-400 absolute right-1.5 top-2 pointer-events-none" />
            </div>
          </div>

          {/* NMS IoU Threshold Selector */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium">IoU:</span>
            <div className="relative">
              <select
                value={nmsThreshold}
                onChange={(e) => handleNmsChange(parseFloat(e.target.value))}
                className="text-xs font-medium font-mono px-2.5 py-1.5 pr-6 rounded-lg border border-slate-200 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#005f60] appearance-none shadow-2xs cursor-pointer"
                title="Non-Maximum Suppression IoU Threshold"
              >
                <option value={0.35}>0.35</option>
                <option value={0.45}>0.45</option>
                <option value={0.55}>0.55</option>
                <option value={0.65}>0.65</option>
              </select>
              <ChevronDown className="w-3 h-3 text-slate-400 absolute right-1.5 top-2 pointer-events-none" />
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. MAIN WORKSPACE: 2-COLUMN SIDE-BY-SIDE (VIEWPORT & CONFIRMATION PANEL)  */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN (7 Cols): Dark Viewport Container & Primary Action Button */}
        <div className="lg:col-span-7 space-y-3.5">
          {/* Large Dark Viewport Box */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="relative w-full h-[470px] bg-[#0c1427] rounded-xl overflow-hidden flex flex-col items-center justify-center border border-slate-800 shadow-inner"
          >
            {/* ==================== WEBCAM VIEWPORT (Always mounted to preserve video stream) ==================== */}
            <div
              ref={webcamContainerRef}
              className={`relative w-full h-full flex items-center justify-center ${
                activeTab === 'webcam' ? 'block' : 'hidden'
              }`}
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-contain ${isCameraActive ? 'block' : 'hidden'}`}
              />

              {/* Bounding Boxes Overlay for Active Webcam */}
              {isCameraActive && (
                <BoundingBoxOverlay
                  objects={webcamDetectedObjects}
                  containerRef={webcamContainerRef}
                  sourceWidth={videoRef.current?.videoWidth || 640}
                  sourceHeight={videoRef.current?.videoHeight || 480}
                  colorScheme="teal"
                />
              )}

              {/* Webcam Inactive Screen */}
              {!isCameraActive && (
                <div className="text-center p-6 space-y-3 z-10 select-none">
                  <div className="w-13 h-13 rounded-2xl bg-slate-900/90 border border-slate-700/80 flex items-center justify-center mx-auto text-slate-400 shadow-md">
                    <Camera className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-base font-semibold text-white tracking-tight">
                      Webcam Inactive
                    </h4>
                    <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                      Live video stream will appear here when camera is started
                    </p>
                  </div>
                </div>
              )}

              {/* Active Camera Live HUD Overlay */}
              {isCameraActive && (
                <div className="absolute top-3 left-3 right-3 z-30 flex items-center justify-between pointer-events-none">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono font-semibold text-emerald-400 bg-slate-950/80 px-2.5 py-1 rounded-md border border-slate-800 flex items-center gap-1.5 backdrop-blur-xs">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                      LIVE STREAM ({fps} FPS)
                    </span>
                    {webcamInferenceTime > 0 && (
                      <span className="text-[11px] font-mono text-slate-300 bg-slate-950/80 px-2 py-1 rounded-md border border-slate-800 backdrop-blur-xs">
                        {webcamInferenceTime}ms
                      </span>
                    )}
                  </div>

                  <span className="text-[11px] font-mono font-semibold text-teal-300 bg-slate-950/80 px-2.5 py-1 rounded-md border border-slate-800 backdrop-blur-xs">
                    {webcamDetectedObjects.length} Post-NMS Detections
                  </span>
                </div>
              )}
            </div>

            {/* ==================== UPLOAD VIEWPORT (Always mounted, toggled cleanly) ==================== */}
            <div
              ref={uploadContainerRef}
              className={`relative w-full h-full flex items-center justify-center p-3 ${
                activeTab === 'upload' ? 'block' : 'hidden'
              }`}
            >
              {uploadedResult ? (
                <>
                  <img
                    src={uploadedResult.dataUrl}
                    alt="Uploaded Inventory Photo"
                    className="max-w-full max-h-full object-contain rounded select-none"
                  />

                  {/* Bounding Boxes Overlay for Static Image */}
                  <BoundingBoxOverlay
                    objects={uploadDetectedObjects}
                    containerRef={uploadContainerRef}
                    sourceWidth={uploadedResult.width}
                    sourceHeight={uploadedResult.height}
                    colorScheme="teal"
                  />


                  {/* Image Top Info Bar */}
                  <div className="absolute top-3 left-3 right-3 z-30 flex items-center justify-between">
                    <span className="text-[11px] font-mono text-slate-200 bg-slate-950/80 px-2.5 py-1 rounded-md border border-slate-800 backdrop-blur-xs truncate max-w-[200px]">
                      {uploadedResult.fileInfo.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setUploadedResult(null);
                        setUploadDetectedObjects([]);
                        setConfirmedItems([]);
                        setDiagnostics(null);
                        setHasRunInference(false);
                      }}
                      className="px-2 py-1 text-[11px] font-medium text-slate-300 hover:text-white bg-slate-900/90 hover:bg-slate-800 rounded border border-slate-700 transition-colors shadow-2xs cursor-pointer"
                    >
                      Clear Image
                    </button>
                  </div>
                </>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="text-center p-6 space-y-3 z-10 select-none cursor-pointer group"
                >
                  <div className="w-13 h-13 rounded-2xl bg-slate-900/90 border border-slate-700/80 group-hover:border-teal-500/50 flex items-center justify-center mx-auto text-teal-400 shadow-md transition-colors">
                    <Upload className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-base font-semibold text-white tracking-tight">
                      Image Viewport
                    </h4>
                    <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                      Drag & drop an inventory photo here, or click upload below
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Hidden File Input for Device Upload */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.JPG,.jpeg,.JPEG,.png,.webp,image/*"
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* Errors Display */}
          {cameraError && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <strong className="block font-semibold">Camera Access Issue:</strong>
                {cameraError}
              </div>
            </div>
          )}

          {decodeError && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <strong className="block font-semibold">Image Decoding Issue:</strong>
                {decodeError}
              </div>
            </div>
          )}

          {modelError && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <strong className="block font-semibold">TFLite Neural Model Issue:</strong>
                {modelError}
              </div>
            </div>
          )}

          {/* Loading States for Upload Processing */}
          {isDecoding && (
            <div className="p-3 rounded-lg bg-teal-50 border border-teal-200 text-teal-900 text-xs flex items-center gap-2 font-mono">
              <RefreshCw className="w-4 h-4 text-[#005f60] animate-spin" />
              <span>Transcoding binary photo buffer...</span>
            </div>
          )}

          {isProcessingModel && (
            <div className="p-3 rounded-lg bg-teal-50 border border-teal-200 text-teal-900 text-xs flex items-center gap-2 font-mono">
              <Cpu className="w-4 h-4 text-[#005f60] animate-pulse" />
              <span>Analyzing image...</span>
            </div>
          )}

          {/* PRIMARY BUTTON DIRECTLY UNDER VIEWPORT - Compact & Clear */}
          {activeTab === 'webcam' ? (
            !isCameraActive ? (
              <button
                type="button"
                id="start-webcam-btn"
                onClick={startCamera}
                className="w-full py-2.5 px-4 rounded-lg bg-[#005f60] hover:bg-[#004d4e] text-white text-xs font-semibold shadow-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Start Webcam</span>
              </button>
            ) : (
              <button
                type="button"
                id="stop-webcam-btn"
                onClick={stopCamera}
                className="w-full py-2.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold shadow-xs flex items-center justify-center gap-2 transition-colors cursor-pointer border border-slate-700"
              >
                <Square className="w-3.5 h-3.5 fill-current text-rose-400" />
                <span>Stop Webcam</span>
              </button>
            )
          ) : (
            <button
              type="button"
              id="upload-device-btn"
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-2.5 px-4 rounded-lg bg-[#005f60] hover:bg-[#004d4e] text-white text-xs font-semibold shadow-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload Image from Device</span>
            </button>
          )}
        </div>

        {/* RIGHT COLUMN (5 Cols): DETECTION CONFIRMATION CARD */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col min-h-[470px]">
            {/* Confirmation Header */}
            <div className="pb-3 border-b border-slate-100">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900 tracking-wider uppercase">
                  Detection Confirmation
                </h3>
                <span className="font-semibold font-mono text-xs px-2.5 py-0.5 rounded border border-teal-600/30 text-[#005f60] bg-teal-50">
                  {totalConfirmedUnits} Confirmed Units
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 font-normal">
                Review, verify & edit AI count before updating inventory
              </p>
            </div>

            {/* Success Toast / Notification */}
            {confirmSuccessMessage && (
              <div className="mt-3 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-start gap-2 animate-in fade-in duration-200">
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>{confirmSuccessMessage}</span>
              </div>
            )}

            {/* Confirmation Body: Empty State vs Items List */}
            <div className="flex-1 py-4 flex flex-col justify-between">
              {confirmedItems.length === 0 ? (
                // ==================== EMPTY STATE ====================
                <div className="my-auto text-center py-8 space-y-2.5">
                  <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
                    <Layers className="w-5 h-5 text-slate-400" />
                  </div>
                  <div>
                    <h5 className="text-sm font-semibold text-slate-800">
                      No objects detected
                    </h5>
                    <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                      {activeTab === 'webcam'
                        ? isCameraActive
                          ? 'Model is scanning frames. No items matching threshold detected.'
                          : 'Start the webcam or switch to Upload Image to detect items.'
                        : hasRunInference
                        ? `The YOLO neural model analyzed the image with confidence threshold ${(confidenceThreshold * 100).toFixed(0)}% and found no matching objects.`
                        : 'Upload an inventory image to detect items.'}
                    </p>
                  </div>

                  <div className="pt-2">
                    <button
                      type="button"
                      id="add-item-manually-empty-btn"
                      onClick={() => setShowManualAddSelect(true)}
                      className="px-4 py-2 rounded-lg border border-dashed border-slate-300 hover:border-slate-400 hover:bg-slate-50 text-slate-700 text-xs font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
                    >
                      <Plus className="w-3.5 h-3.5 text-slate-500" />
                      <span>Add Item Manually</span>
                    </button>
                  </div>
                </div>
              ) : (
                // ==================== DETECTED ITEMS LIST ====================
                <div className="space-y-3">
                  <div className="max-h-[260px] overflow-y-auto pr-1 space-y-2">
                    {confirmedItems.map((item) => (
                      <div
                        key={item.className}
                        className="p-3 rounded-lg border border-slate-200/90 bg-slate-50/70 hover:bg-slate-50 flex items-center justify-between gap-3 text-xs transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold text-slate-900 truncate">
                              {item.className}
                            </span>
                            {item.isManual ? (
                              <span className="text-[10px] font-mono text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded font-medium">
                                Manual
                              </span>
                            ) : (
                              <span className="text-[10px] font-mono text-teal-700 bg-teal-50 border border-teal-200 px-1.5 py-0.2 rounded font-medium">
                                {(item.confidence * 100).toFixed(0)}%
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-500 block truncate mt-0.5 font-normal">
                            {item.category}
                          </span>
                        </div>

                        {/* Quantity Stepper & Delete */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleQuantityChange(item.className, -1)}
                            className="w-6 h-6 rounded bg-white hover:bg-slate-100 border border-slate-300 flex items-center justify-center text-slate-600 transition-colors cursor-pointer"
                            title="Decrease quantity"
                          >
                            <Minus className="w-3 h-3" />
                          </button>

                          <span className="w-8 text-center font-mono font-semibold text-slate-900 text-sm">
                            {item.quantity}
                          </span>

                          <button
                            type="button"
                            onClick={() => handleQuantityChange(item.className, 1)}
                            className="w-6 h-6 rounded bg-white hover:bg-slate-100 border border-slate-300 flex items-center justify-center text-slate-600 transition-colors cursor-pointer"
                            title="Increase quantity"
                          >
                            <Plus className="w-3 h-3" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleRemoveItem(item.className)}
                            className="p-1 text-slate-400 hover:text-rose-600 transition-colors ml-1 cursor-pointer"
                            title="Remove item"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Add Another Item Manually */}
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setShowManualAddSelect(!showManualAddSelect)}
                      className="text-xs font-medium text-[#005f60] hover:text-[#004d4e] flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{showManualAddSelect ? 'Cancel Manual Add' : 'Add Another Item Manually'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Inline Manual Add Dropdown Form */}
              {showManualAddSelect && (
                <div className="my-2 p-3 rounded-lg bg-teal-50/60 border border-teal-200 text-xs space-y-2">
                  <span className="font-semibold text-slate-800 block text-xs">
                    Select Item to Add:
                  </span>
                  <div className="flex items-center gap-2">
                    <select
                      value={manualSelectClass}
                      onChange={(e) => setManualSelectClass(e.target.value)}
                      className="flex-1 px-2.5 py-1.5 rounded-md border border-slate-300 bg-white text-slate-800 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-[#005f60]"
                    >
                      {DEFAULT_YOLO_LABELS.map((lbl) => (
                        <option key={lbl.id} value={lbl.label}>
                          {lbl.label} ({lbl.category})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleAddManualItem}
                      className="px-3 py-1.5 rounded-md bg-[#005f60] hover:bg-[#004d4e] text-white font-semibold text-xs shadow-2xs cursor-pointer"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}

              {/* Confirmation Footer Form & Commit Action */}
              {confirmedItems.length > 0 && (
                <div className="pt-4 border-t border-slate-100 space-y-3 mt-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-0.5">
                        Operator
                      </label>
                      <input
                        type="text"
                        value={operator}
                        onChange={(e) => setOperator(e.target.value)}
                        placeholder="Senior Storekeeper"
                        className="w-full px-2.5 py-1.5 text-xs rounded-md border border-slate-300 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#005f60]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-0.5">
                        Scan Notes
                      </label>
                      <input
                        type="text"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder={`e.g. Audit at ${rackShelf}`}
                        className="w-full px-2.5 py-1.5 text-xs rounded-md border border-slate-300 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-[#005f60]"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    id="confirm-inventory-update-btn"
                    onClick={handleFinalConfirm}
                    disabled={totalConfirmedUnits === 0}
                    className="w-full py-2.5 px-4 rounded-lg bg-[#005f60] hover:bg-[#004d4e] disabled:opacity-50 text-white text-xs font-semibold shadow-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <Check className="w-4 h-4" />
                    <span>Confirm & Update Inventory ({totalConfirmedUnits} Units)</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. TEMPORARY YOLO TFLITE DIAGNOSTICS PANEL (Dynamic shapes, NMS, Latency) */}
      {/* ========================================================================= */}
      <DiagnosticsPanel
        diagnostics={diagnostics}
        isProcessing={isProcessingModel}
      />
    </div>
  );
};
