import { apiUrl } from './apiBase';
import { ConsultantResponse, ConsultantStatus } from '../types/programmeConsultant';

interface HistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

async function parseError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body.error || body.message || `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

class ProgrammeConsultantService {
  async getStatus(): Promise<ConsultantStatus> {
    const response = await fetch(apiUrl('/api/consultant/status'), {
      credentials: 'include',
    });
    if (!response.ok) throw new Error(await parseError(response));
    return response.json();
  }

  async chat(message: string, history: HistoryItem[]): Promise<ConsultantResponse> {
    const response = await fetch(apiUrl('/api/consultant/chat'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history }),
    });
    if (!response.ok) throw new Error(await parseError(response));
    return response.json();
  }
}

export const programmeConsultantService = new ProgrammeConsultantService();
