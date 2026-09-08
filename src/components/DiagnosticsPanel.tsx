import React, { useState } from 'react';
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Cpu,
  Layers,
  ShieldCheck,
  Zap,
  Sliders,
  CheckCircle2,
  Filter,
  AlertCircle,
  Check,
} from 'lucide-react';
import { PipelineDiagnostics } from '../types';

interface DiagnosticsPanelProps {
  diagnostics: PipelineDiagnostics | null;
  isProcessing?: boolean;
}

export const DiagnosticsPanel: React.FC<DiagnosticsPanelProps> = ({
  diagnostics,
  isProcessing = false,
}) => {
  const [isOpen, setIsOpen] = useState(true);

  if (!diagnostics) {
    return (
      <div className="bg-slate-900 text-slate-200 rounded-xl border border-slate-800 p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-teal-400" />
            <h4 className="text-xs font-semibold text-white uppercase tracking-wider">
              YOLO TFLite Pipeline Diagnostics
            </h4>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
              Standby
            </span>
          </div>
        </div>
        <p className="text-xs text-slate-400 mt-2">
          Start webcam or upload an image to view live input/output shapes, anchor evaluations, thresholding, and class-aware NMS results from the real <code className="text-teal-300 font-mono">inventory_yolo.tflite</code> model.
        </p>
      </div>
    );
  }

  const finalObjectEntries = Object.entries(diagnostics.finalObjectCount || {});

  return (
    <div className="bg-[#0b1220] text-slate-100 rounded-xl border border-slate-800 shadow-md overflow-hidden transition-all">
      {/* Panel Header */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="px-4 py-3 bg-slate-900/90 border-b border-slate-800/80 flex items-center justify-between cursor-pointer hover:bg-slate-900 transition-colors select-none"
      >
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className={`w-2 h-2 rounded-full ${diagnostics.errorMessage ? 'bg-rose-500' : 'bg-emerald-400 animate-pulse'}`} />
          <div className="flex items-center gap-1.5">
            <Cpu className="w-4 h-4 text-teal-400" />
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
              TFLite Detection Diagnostics
            </h4>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-teal-950 text-teal-300 border border-teal-800/80 font-medium">
            {diagnostics.runtimeStatus || 'Active Runtime'}
          </span>
          <span className="text-[10px] font-mono text-slate-400">
            {diagnostics.modelStatus || `${diagnostics.modelName} (${Math.round(diagnostics.modelFileSize / 1024)} KB)`}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-emerald-400 font-semibold flex items-center gap-1">
            <Zap className="w-3.5 h-3.5" />
            {diagnostics.totalTimeMs}ms
          </span>
          <button
            type="button"
            className="text-slate-400 hover:text-white transition-colors"
          >
            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="p-4 space-y-4 text-xs font-sans">
          {/* Error Banner if any */}
          {diagnostics.errorMessage && (
            <div className="bg-rose-950/80 border border-rose-700/80 rounded-lg p-3 text-rose-200 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-rose-300">Inference Error Encountered</div>
                <div className="font-mono text-[11px] mt-0.5 text-rose-200 break-all">
                  {diagnostics.errorMessage}
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 1. KEY DIAGNOSTIC METRICS GRID                                            */}
          {/* ========================================================================= */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            {/* Metric 1: Input Shape */}
            <div className="bg-slate-950/80 rounded-lg p-2.5 border border-slate-800/80">
              <div className="text-[10px] uppercase font-semibold text-slate-400 flex items-center gap-1">
                <Sliders className="w-3 h-3 text-cyan-400" />
                Input Shape
              </div>
              <div className="font-mono text-xs font-bold text-white mt-1">
                [{diagnostics.inputShape.join(', ')}]
              </div>
              <div className="text-[10px] text-slate-400 font-mono mt-0.5 truncate" title={diagnostics.inputDataType}>
                {diagnostics.inputLayout} {diagnostics.inputDataType.split(' ')[0]}
              </div>
            </div>

            {/* Metric 2: Output Shape */}
            <div className="bg-slate-950/80 rounded-lg p-2.5 border border-slate-800/80">
              <div className="text-[10px] uppercase font-semibold text-slate-400 flex items-center gap-1">
                <Layers className="w-3 h-3 text-indigo-400" />
                Output Shape
              </div>
              <div className="font-mono text-xs font-bold text-white mt-1">
                [{diagnostics.outputShape.join(', ')}]
              </div>
              <div className="text-[10px] text-slate-400 font-mono mt-0.5 truncate" title={`Raw Length: ${diagnostics.rawOutputLength || 'N/A'}`}>
                {diagnostics.outputDataType} ({diagnostics.rawOutputLength?.toLocaleString() || 'tensor'})
              </div>
            </div>

            {/* Metric 3: Raw Predictions */}
            <div className="bg-slate-950/80 rounded-lg p-2.5 border border-slate-800/80">
              <div className="text-[10px] uppercase font-semibold text-slate-400 flex items-center gap-1">
                <Activity className="w-3 h-3 text-amber-400" />
                Raw Predictions
              </div>
              <div className="font-mono text-xs font-bold text-amber-300 mt-1">
                {diagnostics.rawPredictionsCount.toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                Anchors Evaluated
              </div>
            </div>

            {/* Metric 4: Above Threshold */}
            <div className="bg-slate-950/80 rounded-lg p-2.5 border border-slate-800/80">
              <div className="text-[10px] uppercase font-semibold text-slate-400 flex items-center gap-1">
                <Filter className="w-3 h-3 text-teal-400" />
                Above Threshold
              </div>
              <div className="font-mono text-xs font-bold text-teal-300 mt-1">
                {diagnostics.aboveThresholdCount}
              </div>
              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                ≥ {(diagnostics.confidenceThreshold * 100).toFixed(0)}% Conf
              </div>
            </div>

            {/* Metric 5: Detections After NMS */}
            <div className="bg-slate-950/80 rounded-lg p-2.5 border border-slate-800/80">
              <div className="text-[10px] uppercase font-semibold text-slate-400 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                After NMS
              </div>
              <div className="font-mono text-xs font-bold text-emerald-300 mt-1">
                {diagnostics.afterNmsCount}
              </div>
              <div className="text-[10px] text-rose-400/90 font-mono mt-0.5">
                -{diagnostics.suppressedCount} Overlaps
              </div>
            </div>

            {/* Metric 6: Final Object Count */}
            <div className="bg-slate-950/80 rounded-lg p-2.5 border border-slate-800/80">
              <div className="text-[10px] uppercase font-semibold text-slate-400 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-cyan-400" />
                Final Count
              </div>
              <div className="font-mono text-xs font-bold text-cyan-300 mt-1">
                {diagnostics.afterNmsCount} Objects
              </div>
              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                {finalObjectEntries.length} Unique Classes
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* 2. LATENCY & TIMING BREAKDOWN + FINAL OBJECT COUNT BREAKDOWN              */}
          {/* ========================================================================= */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            {/* Pipeline Stage Latencies */}
            <div className="bg-slate-950/60 rounded-lg p-3 border border-slate-800/70">
              <h5 className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                Stage Latency Breakdown
              </h5>
              <div className="space-y-1.5 text-[11px] font-mono">
                <div className="flex justify-between items-center text-slate-300">
                  <span className="text-slate-400">1. Preprocessing (Letterbox & {diagnostics.inputLayout})</span>
                  <span className="text-white font-semibold">{diagnostics.preprocessTimeMs} ms</span>
                </div>
                <div className="flex justify-between items-center text-slate-300">
                  <span className="text-slate-400">2. Model Inference Execution</span>
                  <span className="text-teal-300 font-semibold">{diagnostics.inferenceTimeMs} ms</span>
                </div>
                <div className="flex justify-between items-center text-slate-300">
                  <span className="text-slate-400">3. Class-Aware Non-Maximum Suppression</span>
                  <span className="text-white font-semibold">{diagnostics.nmsTimeMs} ms</span>
                </div>
                <div className="pt-1.5 border-t border-slate-800 flex justify-between items-center text-xs">
                  <span className="font-semibold text-slate-300">Total Pipeline Cycle</span>
                  <span className="font-bold text-emerald-400">{diagnostics.totalTimeMs} ms</span>
                </div>
              </div>
            </div>

            {/* Final Object Count Breakdown by Class */}
            <div className="bg-slate-950/60 rounded-lg p-3 border border-slate-800/70">
              <h5 className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                Final Object Count by Class (Post-NMS)
              </h5>
              {finalObjectEntries.length === 0 ? (
                <div className="text-slate-500 font-mono text-[11px] py-2">
                  No objects passed confidence threshold ({Math.round(diagnostics.confidenceThreshold * 100)}%) and NMS filtering.
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5 max-h-[85px] overflow-y-auto pr-1">
                  {finalObjectEntries.map(([className, count]) => (
                    <div
                      key={className}
                      className="px-2 py-1 rounded bg-slate-900 border border-slate-700/80 flex items-center gap-1.5 text-[11px] font-mono"
                    >
                      <span className="text-slate-300">{className}:</span>
                      <span className="font-bold text-teal-300 bg-teal-950/80 px-1.5 py-0.2 rounded border border-teal-800/60">
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Real-time Status Footer Note */}
          <div className="text-[10px] text-slate-400 flex items-center justify-between border-t border-slate-800/60 pt-2 font-mono">
            <span>
              Runtime: {diagnostics.runtimeStatus} &bull; Model: {diagnostics.modelName} &bull; Conf: {(diagnostics.confidenceThreshold * 100).toFixed(0)}% &bull; IoU: {diagnostics.nmsThreshold}
            </span>
            <span className="text-slate-400">
              Last Ran: {diagnostics.timestamp}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
