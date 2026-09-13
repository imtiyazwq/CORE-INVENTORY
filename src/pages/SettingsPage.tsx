import React, { useState, useRef } from 'react';
import {
  Sliders,
  Cpu,
  Wifi,
  WifiOff,
  RefreshCw,
  Download,
  Upload,
  RotateCcw,
  Plus,
  Trash2,
  CheckCircle,
  AlertTriangle,
  Database,
  Layers,
  Sparkles,
  ChevronDown,
} from 'lucide-react';
import { ModelConfig, YOLOClassLabel, EngineMode } from '../types';
import { PREDEFINED_YOLO_CATEGORIES, modelService } from '../services/modelService';

interface SettingsPageProps {
  modelConfig: ModelConfig;
  onUpdateModelConfig: (config: Partial<ModelConfig>) => void;
  isOnline: boolean;
  simulatedOffline: boolean;
  onToggleSimulateOffline: () => void;
  pendingCount: number;
  lastSyncedAt: string;
  onSyncNow: () => { syncedCount: number; timestamp: string };
  onExportJSON: () => void;
  onImportJSON: (jsonString: string) => { success: boolean; itemCount: number; message?: string };
  onResetFactory: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  modelConfig,
  onUpdateModelConfig,
  isOnline,
  simulatedOffline,
  onToggleSimulateOffline,
  pendingCount,
  lastSyncedAt,
  onSyncNow,
  onExportJSON,
  onImportJSON,
  onResetFactory,
}) => {
  // Local state for model config fields
  const [modelPath, setModelPath] = useState(modelConfig.modelPath);
  const [engineMode, setEngineMode] = useState<EngineMode>(modelConfig.engineMode);
  const [threshold, setThreshold] = useState(modelConfig.confidenceThreshold);
  const [classes, setClasses] = useState<YOLOClassLabel[]>(
    modelConfig.labels || []
  );

  // New class input
  const [newLabel, setNewLabel] = useState('');
  const [newCategory, setNewCategory] = useState<string>(PREDEFINED_YOLO_CATEGORIES[0]);

  // Status feedback
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<{ success: boolean; msg: string } | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Save model config
  const handleSaveModelConfig = () => {
    onUpdateModelConfig({
      modelPath: modelPath.trim() || '/models/inventory_yolo.tflite',
      engineMode,
      confidenceThreshold: threshold,
      labels: classes,
      classes,
    });
    setSaveStatus('YOLO configuration saved successfully.');
    setTimeout(() => setSaveStatus(null), 3500);
  };

  // Add YOLO Class
  const handleAddClass = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanLabel = newLabel.trim();
    if (!cleanLabel) return;

    const newIdx = classes.length > 0 ? Math.max(...classes.map((c) => c.index)) + 1 : 0;
    const newClassItem: YOLOClassLabel = {
      id: `lbl-${Date.now()}`,
      index: newIdx,
      label: cleanLabel,
      category: newCategory,
      // No product mapping exists for a freshly user-added class — see
      // yoloConfig.ts's YOLO_CLASS_SKUS for how the built-in 15 are mapped.
      sku: null,
    };

    const updated = [...classes, newClassItem];
    setClasses(updated);
    onUpdateModelConfig({ labels: updated, classes: updated });
    setNewLabel('');
  };

  // Remove YOLO Class
  const handleRemoveClass = (index: number) => {
    const updated = classes.filter((c) => c.index !== index);
    setClasses(updated);
    onUpdateModelConfig({ labels: updated, classes: updated });
  };

  // Force Sync
  const handleForceSync = () => {
    const res = onSyncNow();
    setSyncFeedback(`Synchronized ${res.syncedCount} queued change(s) at ${res.timestamp}`);
    setTimeout(() => setSyncFeedback(null), 4000);
  };

  // File import ref
  const importFileRef = useRef<HTMLInputElement | null>(null);

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const result = onImportJSON(content);
      if (result.success) {
        setImportStatus({
          success: true,
          msg: `Successfully imported ledger with ${result.itemCount} valid items!`,
        });
      } else {
        setImportStatus({
          success: false,
          msg: `Import rejected: ${result.message}`,
        });
      }
      setTimeout(() => setImportStatus(null), 5000);
    };
    reader.readAsText(file);
    if (importFileRef.current) importFileRef.current.value = '';
  };

  // Helper badge styling for the 5 categories
  const getCategoryBadgeClass = (cat: string) => {
    switch (cat) {
      case 'Craft Materials STEM Kits':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'Electronics Robotics':
        return 'bg-teal-50 text-teal-800 border-teal-200';
      case 'Laboratory Science Supplies':
        return 'bg-emerald-50 text-emerald-800 border-emerald-200';
      case 'Stationery Office Supplies':
        return 'bg-blue-50 text-blue-800 border-blue-200';
      case 'Tools Equipment':
        return 'bg-purple-50 text-purple-800 border-purple-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  return (
    <div className="pb-16 space-y-6">
      {/* 2-Column Responsive Layout: Left (YOLO Model Config only) / Right (Backup, Offline, Threshold) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* ============================================================ */}
        {/* LEFT COLUMN: 75% (8-9 Cols) - YOLO MODEL CONFIGURATION ONLY   */}
        {/* ============================================================ */}
        <div className="lg:col-span-8 xl:col-span-8 space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#005f60] text-white flex items-center justify-center shadow-xs">
                  <Cpu className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">YOLO Model Configuration</h3>
                  <p className="text-[11px] text-slate-500 font-mono">
                    TFLite runtime parameters & neural architecture
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleSaveModelConfig}
                className="px-4 py-2 text-xs font-bold text-white bg-[#005f60] hover:bg-[#004d4e] rounded-lg shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Save Config
              </button>
            </div>

            {saveStatus && (
              <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2 animate-in fade-in">
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{saveStatus}</span>
              </div>
            )}

            {/* Model File Path & Upload Button */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-slate-700">
                  Model Binary Path / Upload
                </label>
                <label
                  htmlFor="tflite-upload-input"
                  className="text-xs font-medium text-[#005f60] hover:text-[#004d4e] flex items-center gap-1 cursor-pointer"
                >
                  <Upload className="w-3 h-3" />
                  <span>Upload custom .tflite</span>
                </label>
                <input
                  id="tflite-upload-input"
                  type="file"
                  accept=".tflite"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const buffer = await file.arrayBuffer();
                      const parsed = await modelService.loadModelFromBuffer(buffer, file.name);
                      setModelPath(file.name);
                      setSaveStatus(
                        `Successfully loaded "${file.name}"! Input: [${parsed.inputTensor.shape.join(', ')}], Output: [${parsed.outputTensor.shape.join(', ')}]`
                      );
                      setTimeout(() => setSaveStatus(null), 5000);
                    } catch (err: any) {
                      alert(`Failed to parse .tflite model: ${err.message}`);
                    }
                  }}
                  className="hidden"
                />
              </div>
              <input
                type="text"
                value={modelPath}
                onChange={(e) => setModelPath(e.target.value)}
                className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-[#005f60] focus:outline-none bg-white text-slate-900"
                placeholder="/models/inventory_yolo.tflite"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Location of the quantized .tflite weights file inside the public directory, or upload a custom model file above.
              </p>
            </div>

            {/* Engine Mode & Input Resolution */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Engine Mode
                </label>
                <select
                  value={engineMode}
                  onChange={(e) => setEngineMode(e.target.value as EngineMode)}
                  className="w-full text-xs px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-[#005f60] focus:outline-none bg-white font-semibold text-slate-900 cursor-pointer"
                >
                  <option value="Real TFLite Model Mode">Real TFLite Model Mode</option>
                  <option value="Demo Simulation Mode">Demo Simulation Mode</option>
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  When "Real TFLite Model Mode" is active, optical tensor inference is executed.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Input Tensor Resolution
                </label>
                <input
                  type="text"
                  disabled
                  value="640 × 640 (NCHW [1, 3, 640, 640])"
                  className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-slate-200 bg-slate-100 text-slate-700 font-medium cursor-not-allowed"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Normalized Float32 pixel values [0.0 - 1.0].
                </p>
              </div>
            </div>

            {/* YOLO Class Labels Section with High Vertical Height & Add Label form matching design */}
            <div className="pt-4 border-t border-slate-100 space-y-3">
              {/* Header Bar with Count + Add Form */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50 p-3 rounded-lg border border-slate-200">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    YOLO LABELS ({classes.length} CLASSES MAPPED)
                  </h4>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Must match model training output tensor order
                  </p>
                </div>

                {/* Add New Class Label Form */}
                <form onSubmit={handleAddClass} className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    placeholder="Class label (e.g. Drone)..."
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60] bg-white text-slate-900 w-44"
                  />
                  <div className="relative">
                    <select
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      className="text-xs px-2.5 py-1.5 pr-7 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60] bg-white text-slate-800 font-medium appearance-none cursor-pointer"
                    >
                      {PREDEFINED_YOLO_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-2 pointer-events-none" />
                  </div>
                  <button
                    type="submit"
                    className="px-3 py-1.5 text-xs font-bold text-white bg-[#005f60] hover:bg-[#004d4e] rounded-lg shadow-2xs transition-colors flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    + Add
                  </button>
                </form>
              </div>

              {/* Class Labels Table - Increased Vertical Height (Comfortably shows 15+ items) */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <div className="max-h-[580px] min-h-[420px] overflow-y-auto">
                  <table className="w-full text-left text-xs whitespace-nowrap border-collapse">
                    <thead className="bg-slate-100/90 border-b border-slate-200 text-slate-700 font-bold sticky top-0 z-10 select-none">
                      <tr>
                        <th className="px-3.5 py-2.5 w-20 border-r border-slate-200/80 font-mono text-[11px] uppercase">
                          Index
                        </th>
                        <th className="px-3.5 py-2.5 border-r border-slate-200/80 uppercase text-[11px]">
                          Class Label
                        </th>
                        <th className="px-3.5 py-2.5 border-r border-slate-200/80 uppercase text-[11px]">
                          Category Tag
                        </th>
                        <th className="px-3 py-2.5 text-right w-16 uppercase text-[11px]">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {classes.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-8 text-center text-slate-400">
                            No class labels configured yet. Add one above.
                          </td>
                        </tr>
                      ) : (
                        classes.map((cls) => (
                          <tr
                            key={cls.index}
                            className="hover:bg-slate-50/80 transition-colors divide-x divide-slate-100"
                          >
                            <td className="px-3.5 py-2">
                              <span className="inline-block px-1.5 py-0.5 rounded bg-teal-50 text-[#005f60] font-mono font-bold text-xs border border-teal-200">
                                #{cls.index}
                              </span>
                            </td>
                            <td className="px-3.5 py-2 font-bold text-slate-900 font-mono text-xs">
                              {cls.label}
                            </td>
                            <td className="px-3.5 py-2">
                              <span
                                className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${getCategoryBadgeClass(
                                  cls.category
                                )}`}
                              >
                                {cls.category}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <button
                                type="button"
                                onClick={() => handleRemoveClass(cls.index)}
                                className="text-slate-400 hover:text-rose-600 p-1 rounded hover:bg-rose-50 transition-colors"
                                title="Remove Class"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ============================================================ */}
        {/* RIGHT COLUMN: Remaining System Controls (3 Vertical Cards)   */}
        {/* ============================================================ */}
        <div className="lg:col-span-4 xl:col-span-4 space-y-6">
          {/* Card 1: Data Ledger Backup */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-[#005f60]">
                  <Database className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Data Ledger Backup</h3>
                  <p className="text-[11px] text-slate-500">
                    Export & restore complete catalog ledger
                  </p>
                </div>
              </div>
            </div>

            {importStatus && (
              <div
                className={`p-2.5 rounded-lg text-xs flex items-start gap-2 ${
                  importStatus.success
                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                    : 'bg-rose-50 border border-rose-200 text-rose-800'
                }`}
              >
                {importStatus.success ? (
                  <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                )}
                <span>{importStatus.msg}</span>
              </div>
            )}

            <div className="space-y-2.5">
              <button
                type="button"
                onClick={onExportJSON}
                className="w-full py-2.5 px-3 text-xs font-bold text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-2xs"
              >
                <Download className="w-4 h-4 text-slate-600" />
                Export Ledger JSON
              </button>

              <button
                type="button"
                onClick={() => importFileRef.current?.click()}
                className="w-full py-2.5 px-3 text-xs font-bold text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-2xs"
              >
                <Upload className="w-4 h-4 text-slate-600" />
                Import Ledger JSON
              </button>
              <input
                ref={importFileRef}
                type="file"
                accept=".json"
                onChange={handleImportFile}
                className="hidden"
              />
            </div>

            {/* Factory Reset Section */}
            <div className="pt-3 border-t border-slate-100">
              {showResetConfirm ? (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-rose-900">
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                    Confirm Clean Reset?
                  </div>
                  <p className="text-[11px] text-rose-700">
                    This will clear all local inventory records, activity logs, and mutations, resetting the inventory to a clean state.
                  </p>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowResetConfirm(false)}
                      className="px-2.5 py-1 text-xs text-slate-600 hover:bg-white rounded font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowResetConfirm(false);
                        onResetFactory();
                      }}
                      className="px-3 py-1 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded shadow-xs"
                    >
                      Yes, Reset
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowResetConfirm(true)}
                  className="w-full py-2 px-3 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100/80 border border-rose-200 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Clear All Data & Reset
                </button>
              )}
            </div>
          </div>

          {/* Card 2: Offline-First Engine */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                {isOnline ? (
                  <Wifi className="w-4 h-4 text-emerald-600" />
                ) : (
                  <WifiOff className="w-4 h-4 text-amber-600" />
                )}
                <h3 className="text-sm font-bold text-slate-900">Offline-First Engine</h3>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-600 font-medium">Status:</span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                  isOnline
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-amber-50 text-amber-800 border-amber-200'
                }`}
              >
                {isOnline ? 'Online' : 'Local Storage Active'}
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-600">Pending Queue:</span>
                <span className="font-mono font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                  {pendingCount} mutation{pendingCount === 1 ? '' : 's'}
                </span>
              </div>

              <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-600">Last Synced:</span>
                <span className="font-mono text-slate-700 font-bold text-[11px] truncate max-w-[130px]" title={lastSyncedAt}>
                  {lastSyncedAt}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed bg-slate-50 p-2.5 rounded-lg border border-slate-200">
              Changes are safely committed to local storage first, then synced when a connection is available.
            </p>

            {syncFeedback && (
              <div className="p-2 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-1.5 animate-in fade-in">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>{syncFeedback}</span>
              </div>
            )}

            <div className="space-y-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={handleForceSync}
                className="w-full py-2 px-3 text-xs font-bold text-white bg-[#005f60] hover:bg-[#004d4e] rounded-lg shadow-2xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Force Sync Queue
              </button>

              <button
                type="button"
                onClick={onToggleSimulateOffline}
                className={`w-full py-1.5 px-3 text-xs font-medium rounded-lg border transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                  simulatedOffline
                    ? 'bg-amber-100 text-amber-900 border-amber-300 font-bold'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {simulatedOffline ? (
                  <>
                    <WifiOff className="w-3.5 h-3.5 text-amber-800" />
                    Offline Mode Active
                  </>
                ) : (
                  <>
                    <Wifi className="w-3.5 h-3.5 text-slate-500" />
                    Simulate Offline
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Card 3: Confidence Threshold */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-teal-50 text-[#005f60] border border-teal-200 flex items-center justify-center">
                  <Sliders className="w-3.5 h-3.5" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">Confidence Threshold</h3>
              </div>
              <span className="font-mono text-xs font-bold text-[#005f60] bg-teal-50 border border-teal-200 px-2 py-0.5 rounded">
                {(threshold * 100).toFixed(0)}%
              </span>
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              Minimum probability required for YOLO object bounding boxes to be detected and counted. Higher values reduce false positives (precision) while lower values capture faint objects (recall).
            </p>

            <div className="space-y-2">
              <input
                type="range"
                min={0.1}
                max={0.95}
                step={0.05}
                value={threshold}
                onChange={(e) => setThreshold(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-[#005f60]"
              />
              <div className="flex justify-between text-[10px] font-mono text-slate-400">
                <span>0.10 (High Recall)</span>
                <span>0.50</span>
                <span>0.95 (High Precision)</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSaveModelConfig}
              className="w-full py-1.5 px-3 text-xs font-bold text-[#005f60] bg-teal-50 hover:bg-teal-100/80 border border-teal-200 rounded-lg transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              Apply Threshold
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
