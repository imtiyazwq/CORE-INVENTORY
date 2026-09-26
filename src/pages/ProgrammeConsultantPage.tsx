import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Compass,
  Database,
  GraduationCap,
  Lightbulb,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Users,
  Wifi,
  Wrench,
  Zap,
} from 'lucide-react';

type YesNoUnsure = 'Yes' | 'No' | 'Not sure';
type VenueType = 'Indoor' | 'Outdoor' | 'Sheltered outdoor' | 'Not sure';
type BudgetPreference = 'Low' | 'Medium' | 'High' | 'Flexible' | 'Not sure';
type PlannerStep = 'requirements' | 'recommendations' | 'review' | 'details' | 'confirmation';

interface CatalogueOffering {
  offeringId: string;
  activityTitle: string;
  offeringType: string;
  shortDescription?: string;
  stemDomain?: string;
  keyConcepts?: string;
  learningOutcomes?: string;
  recommendedAge?: string;
  audienceTypes?: string;
  standardDurationMin?: number;
  minParticipants?: number;
  maxParticipants?: number;
  deliveryMode?: string;
  indoorOutdoor?: string;
  electricityRequired?: string;
  internetRequired?: string;
  waterRequired?: string;
  facilitatorsRequired?: number;
  setupTimeMin?: number;
  accessibilityNotes?: string;
  safetyLevel?: string;
  keyHazards?: string;
  participantHandlingRule?: string;
  suitableThemes?: string;
  suitableObjectives?: string;
  engagementMethods?: string;
  customisableElements?: string;
  keyConstraints?: string;
  costBand?: string;
  availabilityStatus?: string;
  dataConfidence?: string;
  stemDomains?: string[];
  audiences?: string[];
  themes?: string[];
  objectives?: string[];
}

interface CataloguePayload {
  source?: string;
  offerings: CatalogueOffering[];
}

interface ProgrammeRequest {
  theme: string;
  objective: string;
  ageGroup: string;
  exactAge: string;
  participantCount: number;
  durationHours: number;
  durationMinutes: number;
  venue: VenueType;
  electricity: YesNoUnsure;
  internet: YesNoUnsure;
  water: YesNoUnsure;
  budget: BudgetPreference;
  accessibility: string[];
  additionalRequirements: string;
}

interface ProgrammeOption {
  id: string;
  title: string;
  offerings: CatalogueOffering[];
  score: number;
  totalDuration: number;
  domains: string[];
  fitReasons: string[];
  warnings: string[];
}

interface BookingDetails {
  fullName: string;
  organisation: string;
  email: string;
  phone: string;
  programmeDate: string;
  preferredStartTime: string;
  additionalNotes: string;
}

const AGE_GROUPS = ['Pre-school', 'Lower Primary', 'Upper Primary', 'Secondary', 'Tertiary', 'Adults', 'Families / Public'];
const THEME_OPTIONS = ['STEM', 'Sustainability', 'Technology', 'Engineering', 'Science', 'Innovation', 'Environment', 'Energy', 'Creativity'];
const OBJECTIVE_OPTIONS = [
  'Introduce STEM concepts',
  'Encourage problem solving',
  'Hands-on learning',
  'Team building',
  'Sustainability awareness',
  'Coding / technology exposure',
  'Science engagement',
  'Innovation and creativity',
];
const ACCESSIBILITY_OPTIONS = ['Mobility support', 'Visual support', 'Hearing support', 'Fine-motor support', 'Sensory consideration'];

const INITIAL_REQUEST: ProgrammeRequest = {
  theme: 'STEM',
  objective: 'Hands-on learning',
  ageGroup: 'Secondary',
  exactAge: '',
  participantCount: 30,
  durationHours: 3,
  durationMinutes: 0,
  venue: 'Indoor',
  electricity: 'Yes',
  internet: 'Not sure',
  water: 'Not sure',
  budget: 'Flexible',
  accessibility: [],
  additionalRequirements: '',
};

const EMPTY_BOOKING: BookingDetails = {
  fullName: '',
  organisation: '',
  email: '',
  phone: '',
  programmeDate: '',
  preferredStartTime: '',
  additionalNotes: '',
};

const STEPS = [
  { key: 'requirements', label: 'Requirements' },
  { key: 'recommendations', label: 'Recommendations' },
  { key: 'review', label: 'Review' },
  { key: 'details', label: 'Details' },
  { key: 'confirmation', label: 'Confirmation' },
] as const;

function getStepIndex(step: PlannerStep) {
  return STEPS.findIndex((item) => item.key === step);
}

function normalise(value?: string) {
  return (value || '').toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim();
}

function tokenise(value: string) {
  return normalise(value).split(' ').filter((token) => token.length > 2);
}

function textIncludesAny(text: string, words: string[]) {
  return words.some((word) => text.includes(normalise(word)));
}

function parseAgeRange(value?: string): { min?: number; max?: number } {
  if (!value) return {};
  const plus = value.match(/(\d+)\s*\+/);
  if (plus) return { min: Number(plus[1]) };
  const range = value.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const single = value.match(/\d+/);
  return single ? { min: Number(single[0]), max: Number(single[0]) } : {};
}

function audienceTerms(ageGroup: string) {
  switch (ageGroup) {
    case 'Pre-school': return ['pre-school', 'preschool'];
    case 'Lower Primary': return ['primary'];
    case 'Upper Primary': return ['primary'];
    case 'Secondary': return ['secondary'];
    case 'Tertiary': return ['tertiary'];
    case 'Adults': return ['adults', 'public', 'teachers'];
    case 'Families / Public': return ['families', 'public'];
    default: return [];
  }
}

function requirementMinutes(request: ProgrammeRequest) {
  return Math.max(0, request.durationHours * 60 + request.durationMinutes);
}

function capacitySessions(offering: CatalogueOffering, participants: number) {
  if (!offering.maxParticipants || participants <= offering.maxParticipants) return 1;
  return Math.ceil(participants / offering.maxParticipants);
}

function scoreOffering(offering: CatalogueOffering, request: ProgrammeRequest): { score: number; warnings: string[]; disqualified: boolean } {
  const text = normalise([
    offering.activityTitle,
    offering.shortDescription,
    offering.stemDomain,
    offering.keyConcepts,
    offering.learningOutcomes,
    offering.suitableThemes,
    offering.suitableObjectives,
    ...(offering.themes || []),
    ...(offering.objectives || []),
  ].filter(Boolean).join(' '));
  const warnings: string[] = [];
  let score = 0;
  let disqualified = false;

  const theme = normalise(request.theme);
  if (theme === 'stem') {
    const domains = offering.stemDomains || (offering.stemDomain || '').split(';').map((x) => x.trim());
    if (domains.some((d) => ['science', 'technology', 'engineering', 'mathematics'].includes(normalise(d)))) score += 8;
    score += Math.min(4, domains.length);
  } else {
    const themeTokens = tokenise(request.theme);
    if (text.includes(theme)) score += 10;
    score += themeTokens.filter((token) => text.includes(token)).length * 2;
  }

  const objectiveTokens = tokenise(request.objective);
  score += objectiveTokens.filter((token) => text.includes(token)).length * 2;
  if (normalise(request.objective).includes('hands on') && normalise(offering.offeringType).includes('hands on')) score += 5;
  if (normalise(request.objective).includes('coding') && textIncludesAny(text, ['coding', 'microcontroller', 'arduino', 'microbit', 'iot'])) score += 7;
  if (normalise(request.objective).includes('sustainability') && textIncludesAny(text, ['sustainability', 'solar', 'waste', 'environment', 'renewable'])) score += 7;

  const audiences = normalise(offering.audienceTypes);
  const audienceMatches = audienceTerms(request.ageGroup).some((term) => audiences.includes(term));
  if (audienceMatches) score += 6;
  else if (request.ageGroup) {
    warnings.push(`Audience fit is not explicitly verified for ${request.ageGroup}.`);
    score -= 6;
  }

  const age = Number(request.exactAge);
  if (Number.isFinite(age) && age > 0) {
    const range = parseAgeRange(offering.recommendedAge);
    if ((range.min !== undefined && age < range.min) || (range.max !== undefined && age > range.max)) {
      disqualified = true;
    } else {
      score += 5;
    }
  }

  if (offering.minParticipants && request.participantCount < offering.minParticipants) {
    warnings.push(`Verified minimum is ${offering.minParticipants} participants.`);
    score -= 7;
  }
  if (offering.maxParticipants && request.participantCount > offering.maxParticipants) {
    const sessions = capacitySessions(offering, request.participantCount);
    warnings.push(`Would require ${sessions} rotations/parallel groups because verified capacity is ${offering.maxParticipants} per session.`);
    score -= Math.min(8, sessions * 2);
  } else {
    score += 4;
  }

  const availableMinutes = requirementMinutes(request);
  if (offering.standardDurationMin && offering.standardDurationMin > availableMinutes) disqualified = true;
  else score += 4;

  const venue = normalise(offering.indoorOutdoor);
  if (request.venue === 'Outdoor' && venue && !venue.includes('outdoor')) disqualified = true;
  if (request.venue === 'Sheltered outdoor' && venue && !venue.includes('outdoor') && !venue.includes('sheltered')) disqualified = true;

  const electricity = normalise(offering.electricityRequired);
  if (request.electricity === 'No' && electricity === 'yes') disqualified = true;
  const internet = normalise(offering.internetRequired);
  if (request.internet === 'No' && internet === 'yes') disqualified = true;
  const water = normalise(offering.waterRequired);
  if (request.water === 'No' && water === 'yes') disqualified = true;

  const budgetRank: Record<string, number> = { low: 1, medium: 2, high: 3 };
  const requestedBudget = normalise(request.budget);
  const costRank = budgetRank[normalise(offering.costBand)] || 0;
  if (['low', 'medium', 'high'].includes(requestedBudget) && costRank > budgetRank[requestedBudget]) {
    warnings.push(`Cost band is ${offering.costBand}; this is above the selected ${request.budget} preference.`);
    score -= 4;
  }

  if (normalise(offering.availabilityStatus).includes('confirm')) {
    warnings.push('Catalogue availability is listed as to be confirmed.');
  }

  return { score, warnings, disqualified };
}

function buildProgrammeOptions(offerings: CatalogueOffering[], request: ProgrammeRequest): ProgrammeOption[] {
  const scored = offerings
    .map((offering) => ({ offering, ...scoreOffering(offering, request) }))
    .filter((item) => !item.disqualified)
    .sort((a, b) => b.score - a.score);

  const limit = requirementMinutes(request);
  const candidates = scored.slice(0, 12);
  if (!candidates.length) return [];

  const optionSignatures = new Set<string>();
  const options: ProgrammeOption[] = [];

  const pushOption = (title: string, selected: typeof candidates) => {
    if (!selected.length) return;
    const duration = selected.reduce((sum, item) => sum + Number(item.offering.standardDurationMin || 0), 0);
    if (duration > limit) return;
    const signature = selected.map((item) => item.offering.offeringId).sort().join('|');
    if (optionSignatures.has(signature)) return;
    optionSignatures.add(signature);
    const domains = Array.from(new Set(selected.flatMap((item) => item.offering.stemDomains || (item.offering.stemDomain || '').split(';').map((x) => x.trim())).filter(Boolean)));
    const warnings = Array.from(new Set(selected.flatMap((item) => item.warnings)));
    const fitReasons = [
      `${selected.length} verified catalogue ${selected.length === 1 ? 'offering' : 'offerings'} fit within ${limit} minutes of requested programme time.`,
      domains.length > 1 ? `Covers complementary domains: ${domains.join(', ')}.` : `Focuses on ${domains[0] || request.theme}.`,
      request.participantCount > 0 ? `Capacity planning is calculated for ${request.participantCount} participants.` : '',
    ].filter(Boolean);
    options.push({
      id: `option-${options.length + 1}`,
      title,
      offerings: selected.map((item) => item.offering),
      score: selected.reduce((sum, item) => sum + item.score, 0),
      totalDuration: duration,
      domains,
      fitReasons,
      warnings,
    });
  };

  const balanced: typeof candidates = [];
  const seenDomains = new Set<string>();
  for (const candidate of candidates) {
    const duration = balanced.reduce((sum, x) => sum + Number(x.offering.standardDurationMin || 0), 0);
    const nextDuration = duration + Number(candidate.offering.standardDurationMin || 0);
    if (nextDuration > limit || balanced.length >= 3) continue;
    const candidateDomains = candidate.offering.stemDomains || (candidate.offering.stemDomain || '').split(';').map((x) => x.trim());
    if (balanced.length === 0 || candidateDomains.some((d) => !seenDomains.has(normalise(d)))) {
      balanced.push(candidate);
      candidateDomains.forEach((d) => seenDomains.add(normalise(d)));
    }
  }
  pushOption('Balanced Discovery Journey', balanced);

  const handsOn = candidates.filter((item) => normalise(item.offering.offeringType).includes('hands on'));
  const handsOnSelected: typeof candidates = [];
  for (const candidate of handsOn) {
    const nextDuration = handsOnSelected.reduce((sum, x) => sum + Number(x.offering.standardDurationMin || 0), 0) + Number(candidate.offering.standardDurationMin || 0);
    if (nextDuration <= limit && handsOnSelected.length < 3) handsOnSelected.push(candidate);
  }
  pushOption('Hands-on Maker Journey', handsOnSelected);

  const show = candidates.find((item) => normalise(item.offering.offeringType).includes('show'));
  const workshop = candidates.find((item) => normalise(item.offering.offeringType).includes('hands on'));
  if (show && workshop && show.offering.offeringId !== workshop.offering.offeringId) {
    pushOption('Show + Workshop Experience', [show, workshop]);
  }

  if (options.length < 2) pushOption('Focused Experience', [candidates[0]]);
  if (options.length < 3 && candidates[1]) pushOption('Alternative Verified Fit', [candidates[1]]);

  return options.sort((a, b) => b.score - a.score).slice(0, 3);
}

function createBookingReference() {
  const date = new Date();
  const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return `PRG-${day}-${Math.floor(1000 + Math.random() * 9000)}`;
}

const FieldLabel: React.FC<{ children: React.ReactNode; required?: boolean }> = ({ children, required }) => (
  <label className="block text-xs font-bold text-slate-700 mb-1.5">
    {children}{required && <span className="text-rose-500 ml-0.5">*</span>}
  </label>
);

const SelectField: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = (props) => (
  <select {...props} className={`w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[#005f60] focus:ring-2 focus:ring-teal-600/10 ${props.className || ''}`} />
);

const TextField: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input {...props} className={`w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-[#005f60] focus:ring-2 focus:ring-teal-600/10 ${props.className || ''}`} />
);

const ProgrammeCard: React.FC<{
  option: ProgrammeOption;
  request: ProgrammeRequest;
  onChoose: () => void;
}> = ({ option, request, onChoose }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <article className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="p-5 border-b border-slate-100 bg-gradient-to-br from-white to-teal-50/60">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-teal-100 text-teal-800 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider">
              <Sparkles className="w-3 h-3" /> Suggested programme configuration
            </div>
            <h3 className="mt-2 text-lg font-extrabold text-slate-950">{option.title}</h3>
            <p className="mt-1 text-sm text-slate-500">{option.totalDuration} minutes of verified catalogue activity time</p>
          </div>
          <div className="flex flex-wrap gap-1.5 max-w-sm justify-end">
            {option.domains.map((domain) => (
              <span key={domain} className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600">{domain}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          {option.offerings.map((offering) => {
            const sessions = capacitySessions(offering, request.participantCount);
            return (
              <div key={offering.offeringId} className="rounded-xl border border-teal-200 bg-teal-50/40 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-teal-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                    <ShieldCheck className="w-3 h-3" /> Verified Catalogue
                  </span>
                  <span className="font-mono text-[11px] font-bold text-teal-800">{offering.offeringId}</span>
                </div>
                <h4 className="mt-2 text-sm font-bold text-slate-900">{offering.activityTitle}</h4>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">{offering.shortDescription}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                  <span><Clock3 className="inline w-3 h-3 mr-1" />{offering.standardDurationMin ?? '—'} min</span>
                  <span><Users className="inline w-3 h-3 mr-1" />max {offering.maxParticipants ?? '—'}</span>
                  <span className="col-span-2"><GraduationCap className="inline w-3 h-3 mr-1" />{offering.recommendedAge || 'Age not specified'}</span>
                </div>
                {sessions > 1 && (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                    <strong>Proposed operational adaptation:</strong> approximately {sessions} rotations/parallel groups would be needed for {request.participantCount} participants.
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="text-xs font-bold text-slate-900 mb-2">Why this fits</div>
            <ul className="space-y-2">
              {option.fitReasons.map((reason) => (
                <li key={reason} className="flex gap-2 text-xs text-slate-600"><Check className="w-3.5 h-3.5 mt-0.5 text-teal-700 shrink-0" />{reason}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-slate-200 p-4">
            <div className="text-xs font-bold text-slate-900 mb-2">Inventory readiness</div>
            <div className="flex gap-2 text-xs text-slate-600">
              <Database className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />
              <span>Front-end prototype: verified material-to-inventory mapping and live stock reservation require backend integration before checkout can be confirmed.</span>
            </div>
          </div>
        </div>

        {option.warnings.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-900"><AlertTriangle className="w-4 h-4" />Planning notes</div>
            <ul className="mt-2 space-y-1.5 text-xs text-amber-900">
              {option.warnings.map((warning) => <li key={warning}>• {warning}</li>)}
            </ul>
          </div>
        )}

        <button type="button" onClick={() => setExpanded((value) => !value)} className="inline-flex items-center gap-1.5 text-xs font-bold text-[#005f60] hover:underline cursor-pointer">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          {expanded ? 'Hide programme conduct details' : 'How this programme can be conducted'}
        </button>

        {expanded && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
            <div>
              <div className="text-xs font-bold text-slate-900">How this programme can be conducted</div>
              <div className="mt-3 space-y-3">
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-full bg-violet-100 text-violet-800 flex items-center justify-center text-xs font-bold shrink-0">1</div>
                  <div><div className="text-xs font-bold text-slate-800">Welcome & theme framing <span className="ml-1 text-[9px] uppercase text-violet-700">Proposed Enhancement</span></div><p className="text-xs text-slate-600 mt-0.5">Introduce the programme focus, expected outcomes and how the activities connect.</p></div>
                </div>
                {option.offerings.map((offering, index) => (
                  <div key={offering.offeringId} className="flex gap-3">
                    <div className="w-7 h-7 rounded-full bg-teal-100 text-teal-800 flex items-center justify-center text-xs font-bold shrink-0">{index + 2}</div>
                    <div><div className="text-xs font-bold text-slate-800">{offering.offeringId} — {offering.activityTitle}</div><p className="text-xs text-slate-600 mt-0.5">Run the verified {offering.offeringType.toLowerCase()} for approximately {offering.standardDurationMin} minutes. {offering.engagementMethods ? `Catalogue engagement methods include ${offering.engagementMethods}.` : ''}</p></div>
                  </div>
                ))}
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-full bg-violet-100 text-violet-800 flex items-center justify-center text-xs font-bold shrink-0">{option.offerings.length + 2}</div>
                  <div><div className="text-xs font-bold text-slate-800">Closing reflection <span className="ml-1 text-[9px] uppercase text-violet-700">Proposed Enhancement</span></div><p className="text-xs text-slate-600 mt-0.5">Invite participants to connect the activities to the programme objective and share one learning takeaway.</p></div>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-4">
              <div className="text-xs font-bold text-slate-900">Participant journey</div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-600">
                {['Engage', 'Discover', 'Create / Experience', 'Apply', 'Reflect'].map((stage, index, list) => (
                  <React.Fragment key={stage}>
                    <span className="rounded-full border border-teal-200 bg-white px-3 py-1.5">{stage}</span>
                    {index < list.length - 1 && <ArrowRight className="w-3 h-3 text-slate-300" />}
                  </React.Fragment>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">This journey is a proposed facilitation structure, not an additional verified catalogue offering.</p>
            </div>
          </div>
        )}

        <button type="button" onClick={onChoose} className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-[#005f60] px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-[#004b4c] cursor-pointer">
          Choose This Programme <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </article>
  );
};

interface ProgrammeConsultantPageProps {
  onBackToLogin: () => void;
}

export const ProgrammeConsultantPage: React.FC<ProgrammeConsultantPageProps> = ({ onBackToLogin }) => {
  const [catalogue, setCatalogue] = useState<CatalogueOffering[]>([]);
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [loadingCatalogue, setLoadingCatalogue] = useState(true);
  const [step, setStep] = useState<PlannerStep>('requirements');
  const [request, setRequest] = useState<ProgrammeRequest>(INITIAL_REQUEST);
  const [options, setOptions] = useState<ProgrammeOption[]>([]);
  const [selected, setSelected] = useState<ProgrammeOption | null>(null);
  const [booking, setBooking] = useState<BookingDetails>(EMPTY_BOOKING);
  const [bookingReference, setBookingReference] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch('/data-programme-catalogue.json')
      .then((response) => {
        if (!response.ok) throw new Error(`Could not load programme catalogue (${response.status}).`);
        return response.json() as Promise<CataloguePayload>;
      })
      .then((payload) => {
        if (!mounted) return;
        setCatalogue(Array.isArray(payload.offerings) ? payload.offerings : []);
      })
      .catch((error) => {
        if (!mounted) return;
        setCatalogueError(error instanceof Error ? error.message : 'Could not load programme catalogue.');
      })
      .finally(() => mounted && setLoadingCatalogue(false));
    return () => { mounted = false; };
  }, []);

  const availableMinutes = requirementMinutes(request);
  const activeIndex = getStepIndex(step);

  const requestSummary = useMemo(() => [
    ['Theme', request.theme],
    ['Objective', request.objective],
    ['Audience', request.ageGroup + (request.exactAge ? ` • age ${request.exactAge}` : '')],
    ['Participants', String(request.participantCount)],
    ['Duration', `${availableMinutes} minutes`],
    ['Venue', request.venue],
  ], [request, availableMinutes]);

  const toggleAccessibility = (value: string) => {
    setRequest((current) => ({
      ...current,
      accessibility: current.accessibility.includes(value)
        ? current.accessibility.filter((item) => item !== value)
        : [...current.accessibility, value],
    }));
  };

  const submitRequirements = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!request.theme || !request.objective || !request.ageGroup) return setFormError('Please complete the theme, objective and audience fields.');
    if (!request.participantCount || request.participantCount < 1) return setFormError('Participant count must be at least 1.');
    if (availableMinutes < 30) return setFormError('Please provide at least 30 minutes of programme time.');
    if (!catalogue.length) return setFormError('The verified programme catalogue is not available in the front-end bundle.');

    const generated = buildProgrammeOptions(catalogue, request);
    setOptions(generated);
    setSelected(null);
    setStep('recommendations');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const chooseProgramme = (option: ProgrammeOption) => {
    setSelected(option);
    setStep('review');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submitBooking = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (!booking.fullName.trim() || !booking.organisation.trim() || !booking.email.trim() || !booking.phone.trim() || !booking.programmeDate) {
      setFormError('Please complete your name, organisation, email, phone number and programme date.');
      return;
    }
    const reference = createBookingReference();
    setBookingReference(reference);
    sessionStorage.setItem('core_inventory_programme_booking_preview', JSON.stringify({
      reference,
      request,
      booking,
      selected,
      createdAt: new Date().toISOString(),
      prototypeOnly: true,
    }));
    setStep('confirmation');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const startOver = () => {
    setRequest(INITIAL_REQUEST);
    setOptions([]);
    setSelected(null);
    setBooking(EMPTY_BOOKING);
    setBookingReference('');
    setFormError(null);
    setStep('requirements');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-[#f6f8fa] text-slate-900">
      <header className="bg-[#111827] text-white border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#005f60] flex items-center justify-center border border-teal-400/30 shadow-md"><Sparkles className="w-5 h-5 text-teal-100" /></div>
            <div>
              <h1 className="text-base sm:text-lg font-extrabold tracking-wide">Petrosains Programme Consultant</h1>
              <p className="text-[11px] text-teal-300 font-medium">Guest programme planning • No staff account required</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={startOver} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800 cursor-pointer"><RotateCcw className="w-3.5 h-3.5" />Start Over</button>
            <button type="button" onClick={onBackToLogin} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs font-bold text-slate-900 hover:bg-slate-100 cursor-pointer"><ArrowLeft className="w-3.5 h-3.5" />Back to Login</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 lg:py-8">
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-900 flex gap-2.5 mb-5">
          <Lightbulb className="w-4 h-4 mt-0.5 shrink-0" />
          <div><strong>Front-end prototype.</strong> Recommendations are generated locally from the verified catalogue bundled with this build. The booking screens are fully navigable, but final database booking, live stock re-check, checkout and staff Inventory updates are intentionally not performed because this version is front-end only.</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-3 sm:p-4 shadow-sm mb-6 overflow-x-auto">
          <div className="min-w-[640px] flex items-center">
            {STEPS.map((item, index) => {
              const done = index < activeIndex;
              const active = index === activeIndex;
              return (
                <React.Fragment key={item.key}>
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold border ${done ? 'bg-teal-700 text-white border-teal-700' : active ? 'bg-teal-50 text-teal-800 border-teal-500' : 'bg-white text-slate-400 border-slate-300'}`}>{done ? <Check className="w-3.5 h-3.5" /> : index + 1}</div>
                    <span className={`text-xs font-bold ${active ? 'text-slate-950' : done ? 'text-teal-800' : 'text-slate-400'}`}>{item.label}</span>
                  </div>
                  {index < STEPS.length - 1 && <div className={`h-px flex-1 mx-3 ${index < activeIndex ? 'bg-teal-500' : 'bg-slate-200'}`} />}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {loadingCatalogue && (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 flex items-center justify-center gap-3 text-sm text-slate-600"><Loader2 className="w-5 h-5 animate-spin text-[#005f60]" />Loading verified programme catalogue…</div>
        )}
        {catalogueError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900"><strong>Catalogue could not be loaded.</strong> {catalogueError}</div>
        )}

        {!loadingCatalogue && !catalogueError && step === 'requirements' && (
          <section className="grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
            <form onSubmit={submitRequirements} className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="p-5 sm:p-6 border-b border-slate-200 bg-gradient-to-br from-white to-teal-50/50">
                <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-teal-800"><Compass className="w-3.5 h-3.5" />Step 1</div>
                <h2 className="mt-1 text-xl font-extrabold text-slate-950">Tell us about your programme</h2>
                <p className="mt-1 text-sm text-slate-500">Choose the main requirements. You only provide your contact details after you select a programme.</p>
              </div>

              <div className="p-5 sm:p-6 grid gap-5 sm:grid-cols-2">
                <div><FieldLabel required>Programme theme / main focus</FieldLabel><SelectField value={request.theme} onChange={(e) => setRequest({ ...request, theme: e.target.value })}>{THEME_OPTIONS.map((item) => <option key={item}>{item}</option>)}</SelectField></div>
                <div><FieldLabel required>Programme objective</FieldLabel><SelectField value={request.objective} onChange={(e) => setRequest({ ...request, objective: e.target.value })}>{OBJECTIVE_OPTIONS.map((item) => <option key={item}>{item}</option>)}</SelectField></div>
                <div><FieldLabel required>Participant age group</FieldLabel><SelectField value={request.ageGroup} onChange={(e) => setRequest({ ...request, ageGroup: e.target.value })}>{AGE_GROUPS.map((item) => <option key={item}>{item}</option>)}</SelectField></div>
                <div><FieldLabel>Exact age (optional)</FieldLabel><TextField type="number" min="3" max="99" placeholder="e.g. 14" value={request.exactAge} onChange={(e) => setRequest({ ...request, exactAge: e.target.value })} /></div>
                <div><FieldLabel required>Number of participants</FieldLabel><TextField type="number" min="1" value={request.participantCount} onChange={(e) => setRequest({ ...request, participantCount: Number(e.target.value) })} /></div>
                <div>
                  <FieldLabel required>Available programme duration</FieldLabel>
                  <div className="grid grid-cols-2 gap-2"><TextField type="number" min="0" max="12" value={request.durationHours} onChange={(e) => setRequest({ ...request, durationHours: Number(e.target.value) })} /><TextField type="number" min="0" max="59" value={request.durationMinutes} onChange={(e) => setRequest({ ...request, durationMinutes: Number(e.target.value) })} /></div>
                  <div className="grid grid-cols-2 gap-2 mt-1 text-[10px] text-slate-400"><span>Hours</span><span>Minutes</span></div>
                </div>
                <div><FieldLabel>Venue type</FieldLabel><SelectField value={request.venue} onChange={(e) => setRequest({ ...request, venue: e.target.value as VenueType })}>{['Indoor', 'Outdoor', 'Sheltered outdoor', 'Not sure'].map((item) => <option key={item}>{item}</option>)}</SelectField></div>
                <div><FieldLabel>Budget / cost preference</FieldLabel><SelectField value={request.budget} onChange={(e) => setRequest({ ...request, budget: e.target.value as BudgetPreference })}>{['Low', 'Medium', 'High', 'Flexible', 'Not sure'].map((item) => <option key={item}>{item}</option>)}</SelectField></div>

                <div className="sm:col-span-2 grid gap-3 sm:grid-cols-3">
                  {([
                    ['Electricity available?', 'electricity', Zap],
                    ['Internet available?', 'internet', Wifi],
                    ['Water available?', 'water', Wrench],
                  ] as const).map(([label, key, Icon]) => (
                    <div key={key} className="rounded-xl border border-slate-200 p-3"><FieldLabel>{label}</FieldLabel><div className="flex items-center gap-2"><Icon className="w-4 h-4 text-slate-400" /><SelectField value={request[key]} onChange={(e) => setRequest({ ...request, [key]: e.target.value as YesNoUnsure })}>{['Yes', 'No', 'Not sure'].map((item) => <option key={item}>{item}</option>)}</SelectField></div></div>
                  ))}
                </div>

                <div className="sm:col-span-2">
                  <FieldLabel>Accessibility requirements</FieldLabel>
                  <div className="flex flex-wrap gap-2">
                    {ACCESSIBILITY_OPTIONS.map((item) => {
                      const selected = request.accessibility.includes(item);
                      return <button key={item} type="button" onClick={() => toggleAccessibility(item)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${selected ? 'border-teal-600 bg-teal-50 text-teal-800' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>{selected && <Check className="inline w-3 h-3 mr-1" />}{item}</button>;
                    })}
                  </div>
                </div>

                <div className="sm:col-span-2"><FieldLabel>Additional requirements (optional)</FieldLabel><textarea value={request.additionalRequirements} onChange={(e) => setRequest({ ...request, additionalRequirements: e.target.value })} rows={3} placeholder="e.g. Prefer activities involving teamwork." className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-[#005f60] focus:ring-2 focus:ring-teal-600/10" /></div>

                {formError && <div className="sm:col-span-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900 flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />{formError}</div>}

                <div className="sm:col-span-2 flex justify-end"><button type="submit" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#005f60] px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-[#004b4c] cursor-pointer">Find Suitable Programmes <ArrowRight className="w-4 h-4" /></button></div>
              </div>
            </form>

            <aside className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-[#111827] p-5 text-white shadow-sm">
                <ShieldCheck className="w-6 h-6 text-teal-300" />
                <h3 className="mt-3 text-base font-bold">Verified catalogue first</h3>
                <p className="mt-2 text-xs leading-relaxed text-slate-300">Only offerings loaded from the supplied Petrosains Programme Catalogue are displayed as verified activities. Broad STEM requests are balanced across relevant domains where the catalogue allows.</p>
                <div className="mt-4 text-[11px] text-teal-200 font-mono">{catalogue.length} verified offerings loaded</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-bold text-slate-900">How it works</h3>
                <div className="mt-3 space-y-3 text-xs text-slate-600">
                  <div className="flex gap-2"><span className="font-bold text-teal-700">1.</span><span>Enter programme requirements — no contact details yet.</span></div>
                  <div className="flex gap-2"><span className="font-bold text-teal-700">2.</span><span>Review up to three catalogue-based programme configurations.</span></div>
                  <div className="flex gap-2"><span className="font-bold text-teal-700">3.</span><span>Choose one programme and review its activities and constraints.</span></div>
                  <div className="flex gap-2"><span className="font-bold text-teal-700">4.</span><span>Only then enter your booking/contact details.</span></div>
                </div>
              </div>
            </aside>
          </section>
        )}

        {step === 'recommendations' && (
          <section className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-teal-800">Step 2</div><h2 className="text-xl font-extrabold text-slate-950">Recommended programmes</h2><p className="mt-1 text-sm text-slate-500">Choose a programme before entering any personal or contact details.</p></div>
              <button type="button" onClick={() => setStep('requirements')} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"><ArrowLeft className="w-3.5 h-3.5" />Edit requirements</button>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-600">
              {requestSummary.map(([label, value]) => <span key={label}><strong className="text-slate-800">{label}:</strong> {value}</span>)}
            </div>

            {options.length === 0 ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-950"><div className="flex items-center gap-2 font-bold"><AlertTriangle className="w-5 h-5" />No verified catalogue configuration fits the selected hard constraints.</div><p className="mt-2 text-sm">Try increasing programme duration, changing venue/resource restrictions, or reviewing the age requirement. No unsupported offering has been invented.</p></div>
            ) : options.map((option) => <ProgrammeCard key={option.id} option={option} request={request} onChoose={() => chooseProgramme(option)} />)}
          </section>
        )}

        {step === 'review' && selected && (
          <section className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-teal-800">Step 3</div><h2 className="text-xl font-extrabold text-slate-950">Review your selected programme</h2><p className="mt-1 text-sm text-slate-500">Nothing is booked or reserved yet.</p></div><button type="button" onClick={() => setStep('recommendations')} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"><ArrowLeft className="w-3.5 h-3.5" />Back to recommendations</button></div>

            <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="p-5 bg-[#005f60] text-white"><div className="text-[10px] uppercase tracking-[0.16em] font-bold text-teal-100">Selected programme</div><h3 className="mt-1 text-xl font-extrabold">{selected.title}</h3><p className="mt-1 text-sm text-teal-50">{selected.totalDuration} minutes of verified activity time • {selected.domains.join(', ')}</p></div>
                <div className="p-5 space-y-3">{selected.offerings.map((offering) => <div key={offering.offeringId} className="rounded-xl border border-slate-200 p-4"><div className="flex items-center justify-between"><span className="text-[10px] rounded-full bg-teal-700 text-white px-2 py-0.5 font-bold">VERIFIED CATALOGUE</span><span className="font-mono text-xs font-bold text-teal-800">{offering.offeringId}</span></div><h4 className="mt-2 font-bold text-slate-900">{offering.activityTitle}</h4><p className="mt-1 text-xs text-slate-600 leading-relaxed">{offering.shortDescription}</p><div className="mt-3 text-xs text-slate-500">{offering.standardDurationMin} min • {offering.recommendedAge} • {offering.deliveryMode}</div>{offering.keyConstraints && <div className="mt-3 text-xs rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-amber-900"><strong>Constraint:</strong> {offering.keyConstraints}</div>}</div>)}</div>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="text-sm font-bold text-slate-900">Required materials / equipment</h3><div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4"><div className="flex gap-2"><Database className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" /><div><div className="text-xs font-bold text-amber-950">Staff verification required</div><p className="mt-1 text-xs leading-relaxed text-amber-900">This front-end build does not perform the server-side Activity-Based Inventory mapping or live stock re-check. Material quantities are therefore not invented here.</p></div></div></div><div className="mt-3 space-y-2">{selected.offerings.map((offering) => <div key={offering.offeringId} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-xs"><span className="font-semibold text-slate-700">{offering.offeringId} {offering.activityTitle}</span><span className="text-amber-700 font-bold whitespace-nowrap">Requires backend check</span></div>)}</div></div>

                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="text-sm font-bold text-slate-900">Safety & accessibility</h3><div className="mt-3 space-y-3">{selected.offerings.map((offering) => <div key={offering.offeringId} className="text-xs text-slate-600"><strong className="text-slate-800">{offering.activityTitle}:</strong> {offering.safetyLevel ? `Safety ${offering.safetyLevel}. ` : ''}{offering.accessibilityNotes || 'No accessibility note provided in the structured catalogue.'}</div>)}</div></div>

                <button type="button" onClick={() => { setBooking((current) => ({ ...current })); setStep('details'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#005f60] px-5 py-3 text-sm font-bold text-white hover:bg-[#004b4c] cursor-pointer">Continue to Booking Details <ArrowRight className="w-4 h-4" /></button>
              </div>
            </div>
          </section>
        )}

        {step === 'details' && selected && (
          <section className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
            <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm h-fit"><div className="text-[10px] uppercase tracking-[0.16em] font-bold text-teal-800">Selected programme</div><h3 className="mt-1 text-lg font-extrabold text-slate-950">{selected.title}</h3><div className="mt-4 space-y-2">{selected.offerings.map((offering) => <div key={offering.offeringId} className="rounded-lg border border-slate-200 px-3 py-2"><div className="text-xs font-bold text-slate-800">{offering.offeringId} — {offering.activityTitle}</div><div className="text-[11px] text-slate-500 mt-0.5">{offering.standardDurationMin} min • {offering.stemDomain}</div></div>)}</div><div className="mt-4 rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600">Your contact details are requested only now because you selected a programme to proceed with.</div></aside>

            <form onSubmit={submitBooking} className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="p-5 sm:p-6 border-b border-slate-200"><div className="text-[10px] font-bold uppercase tracking-[0.16em] text-teal-800">Step 4</div><h2 className="mt-1 text-xl font-extrabold text-slate-950">Enter booking details</h2><p className="mt-1 text-sm text-slate-500">These details would be attached to the booking and visible to authorised staff after backend integration.</p></div>
              <div className="p-5 sm:p-6 grid gap-5 sm:grid-cols-2">
                <div><FieldLabel required>Full name</FieldLabel><TextField value={booking.fullName} onChange={(e) => setBooking({ ...booking, fullName: e.target.value })} placeholder="Contact person" /></div>
                <div><FieldLabel required>Organisation / school / company</FieldLabel><TextField value={booking.organisation} onChange={(e) => setBooking({ ...booking, organisation: e.target.value })} placeholder="Organisation name" /></div>
                <div><FieldLabel required>Email address</FieldLabel><TextField type="email" value={booking.email} onChange={(e) => setBooking({ ...booking, email: e.target.value })} placeholder="name@example.com" /></div>
                <div><FieldLabel required>Phone number</FieldLabel><TextField value={booking.phone} onChange={(e) => setBooking({ ...booking, phone: e.target.value })} placeholder="e.g. 012-3456789" /></div>
                <div><FieldLabel required>Intended programme date</FieldLabel><TextField type="date" value={booking.programmeDate} onChange={(e) => setBooking({ ...booking, programmeDate: e.target.value })} /></div>
                <div><FieldLabel>Preferred start time</FieldLabel><TextField type="time" value={booking.preferredStartTime} onChange={(e) => setBooking({ ...booking, preferredStartTime: e.target.value })} /></div>
                <div className="sm:col-span-2"><FieldLabel>Number of participants</FieldLabel><TextField value={request.participantCount} disabled className="bg-slate-50" /></div>
                <div className="sm:col-span-2"><FieldLabel>Additional booking notes</FieldLabel><textarea rows={3} value={booking.additionalNotes} onChange={(e) => setBooking({ ...booking, additionalNotes: e.target.value })} className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-[#005f60] focus:ring-2 focus:ring-teal-600/10" placeholder="Optional scheduling or contact notes" /></div>
                {formError && <div className="sm:col-span-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900 flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />{formError}</div>}
                <div className="sm:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><strong>Front-end only:</strong> clicking confirm below creates a local booking preview. It does not reserve stock or write to the staff inventory database.</div>
                <div className="sm:col-span-2 flex flex-wrap justify-between gap-3"><button type="button" onClick={() => setStep('review')} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"><ArrowLeft className="w-4 h-4" />Back</button><button type="submit" className="inline-flex items-center gap-2 rounded-xl bg-[#005f60] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#004b4c] cursor-pointer">Confirm Booking Preview <CheckCircle2 className="w-4 h-4" /></button></div>
              </div>
            </form>
          </section>
        )}

        {step === 'confirmation' && selected && (
          <section className="max-w-3xl mx-auto">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="bg-[#005f60] text-white p-6 text-center"><div className="mx-auto w-12 h-12 rounded-full bg-white/15 flex items-center justify-center"><CheckCircle2 className="w-7 h-7 text-teal-100" /></div><div className="mt-3 text-[10px] uppercase tracking-[0.18em] font-bold text-teal-100">Booking preview created</div><h2 className="mt-1 text-2xl font-extrabold">{bookingReference}</h2></div>
              <div className="p-6 space-y-5">
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-950"><strong>This is a front-end prototype confirmation only.</strong> No database booking has been created and no inventory has been reserved or checked out. Those actions require the backend transaction layer.</div>
                <div className="grid gap-3 sm:grid-cols-2 text-sm"><div className="rounded-xl border border-slate-200 p-4"><div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Programme</div><div className="mt-1 font-bold text-slate-900">{selected.title}</div><div className="mt-1 text-xs text-slate-500">{selected.offerings.map((item) => item.offeringId).join(' • ')}</div></div><div className="rounded-xl border border-slate-200 p-4"><div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Participants</div><div className="mt-1 font-bold text-slate-900">{request.participantCount}</div><div className="mt-1 text-xs text-slate-500">{request.ageGroup}</div></div><div className="rounded-xl border border-slate-200 p-4"><div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Contact</div><div className="mt-1 font-bold text-slate-900">{booking.fullName}</div><div className="mt-1 text-xs text-slate-500">{booking.organisation}</div></div><div className="rounded-xl border border-slate-200 p-4"><div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Programme date</div><div className="mt-1 font-bold text-slate-900">{booking.programmeDate}</div><div className="mt-1 text-xs text-slate-500">{booking.preferredStartTime || 'Start time not specified'}</div></div></div>
                <div className="rounded-xl border border-slate-200 p-4"><div className="text-xs font-bold text-slate-900">Verified activities</div><div className="mt-3 space-y-2">{selected.offerings.map((offering) => <div key={offering.offeringId} className="flex items-center justify-between gap-2 text-xs"><span><strong>{offering.offeringId}</strong> — {offering.activityTitle}</span><span className="rounded-full bg-teal-100 text-teal-800 px-2 py-0.5 font-bold">Verified</span></div>)}</div></div>
                <div className="flex flex-col sm:flex-row gap-3"><button type="button" onClick={startOver} className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[#005f60] px-4 py-3 text-sm font-bold text-white hover:bg-[#004b4c] cursor-pointer"><RotateCcw className="w-4 h-4" />Start Another Programme Request</button><button type="button" onClick={onBackToLogin} className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"><ArrowLeft className="w-4 h-4" />Return to Login</button></div>
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white py-4 px-4 text-center text-[11px] text-slate-500"><span>Petrosains Programme Consultant • Guest planning interface • Catalogue-grounded recommendations</span></footer>
    </div>
  );
};
