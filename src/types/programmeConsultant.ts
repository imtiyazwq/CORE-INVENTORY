export interface ConsultantUnderstanding {
  theme: string;
  objective: string;
  audience: string;
  age: string;
  participants: string;
  duration: string;
  venue: string;
  budget: string;
  constraints: string[];
}

export interface ConsultantRecommendation {
  offeringId: string;
  activityTitle: string;
  offeringType?: string;
  stemDomain?: string;
  recommendedAge?: string;
  standardDurationMin?: number | string;
  minParticipants?: number | string;
  maxParticipants?: number | string;
  deliveryMode?: string;
  indoorOutdoor?: string;
  electricityRequired?: string;
  internetRequired?: string;
  waterRequired?: string;
  facilitatorsRequired?: number | string;
  setupTimeMin?: number | string;
  accessibilityNotes?: string;
  safetyLevel?: string;
  keyHazards?: string;
  participantHandlingRule?: string;
  costBand?: string;
  availabilityStatus?: string;
  dataConfidence?: string;
  keyConstraints?: string;
  reason: string;
  roleInProgramme: string;
}

export interface ParticipantJourneyStage {
  stage: string;
  offeringId?: string | null;
  activityTitle?: string | null;
  purpose: string;
}

export interface ProposedEnhancement {
  label: 'PROPOSED ENHANCEMENT' | string;
  name: string;
  description: string;
  reason: string;
}

export interface InventoryMatch {
  itemCode?: string;
  name: string;
  category?: string;
  availableQuantity?: number;
  totalQuantity?: number;
  unit?: string;
  location?: string;
  rackShelf?: string;
  status?: string;
  matchedTerm?: string;
}

export interface AlternativeRecommendation {
  title: string;
  reason: string;
  offerings: Array<{
    offeringId: string;
    activityTitle: string;
    standardDurationMin?: number | string;
    stemDomain?: string;
  }>;
}

export interface ConsultantResponse {
  understanding: ConsultantUnderstanding;
  missingInformation: string[];
  assumptions: string[];
  recommendations: ConsultantRecommendation[];
  whyTheyWorkTogether: string;
  programmeTitle: string;
  storyline: string;
  participantJourney: ParticipantJourneyStage[];
  proposedEnhancements: ProposedEnhancement[];
  constraints: string[];
  inventoryMatches: InventoryMatch[];
  inventoryNote: string;
  alternativeRecommendation?: AlternativeRecommendation | null;
  validationWarnings: string[];
  catalogueCandidatesConsidered: number;
  verifiedCatalogueSize: number;
  model: string;
}

export interface ConsultantChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  result?: ConsultantResponse;
  error?: string;
}

export interface ConsultantStatus {
  configured: boolean;
  model: string;
  verifiedCatalogueSize: number;
  message?: string;
}
