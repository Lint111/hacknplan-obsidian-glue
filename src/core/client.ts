/**
 * HacknPlan HTTP Client
 *
 * Phase 5 of the sync engine: Direct API client for executing sync operations.
 * Provides methods to create/update/delete design elements.
 */

export interface HacknPlanDesignElement {
  designElementId: number;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  type?: {
    designElementTypeId: number;
    name: string;
  };
}

export interface CreateDesignElementRequest {
  typeId: number;
  name: string;
  description?: string;
}

export interface UpdateDesignElementRequest {
  name?: string;
  description?: string;
}

/**
 * HacknPlan API Client for design element operations
 *
 * Uses HacknPlan REST API v0 for CRUD operations on design elements.
 * All operations are atomic - they either succeed completely or fail with error.
 */
export class HacknPlanClient {
  private readonly baseUrl = 'https://api.hacknplan.com/v0';
  private readonly apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('HacknPlan API key is required');
    }
    this.apiKey = apiKey;
  }

  /**
   * Create a design element in HacknPlan
   *
   * @param projectId - Target project ID
   * @param request - Element creation data
   * @returns Created design element with ID and timestamps
   */
  async createDesignElement(
    projectId: number,
    request: CreateDesignElementRequest
  ): Promise<HacknPlanDesignElement> {
    const url = `${this.baseUrl}/projects/${projectId}/designdocs/elements`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `ApiKey ${this.apiKey}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HacknPlan API error (${response.status}): ${text}`);
    }

    return (await response.json()) as HacknPlanDesignElement;
  }

  /**
   * Update a design element in HacknPlan
   *
   * @param projectId - Target project ID
   * @param elementId - Design element ID to update
   * @param request - Fields to update
   * @returns Updated design element
   */
  async updateDesignElement(
    projectId: number,
    elementId: number,
    request: UpdateDesignElementRequest
  ): Promise<HacknPlanDesignElement> {
    const url = `${this.baseUrl}/projects/${projectId}/designdocs/elements/${elementId}`;

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `ApiKey ${this.apiKey}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HacknPlan API error (${response.status}): ${text}`);
    }

    return (await response.json()) as HacknPlanDesignElement;
  }

  /**
   * Get a design element by ID
   *
   * @param projectId - Target project ID
   * @param elementId - Design element ID
   * @returns Design element or null if not found
   */
  async getDesignElement(
    projectId: number,
    elementId: number
  ): Promise<HacknPlanDesignElement | null> {
    const url = `${this.baseUrl}/projects/${projectId}/designdocs/elements/${elementId}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `ApiKey ${this.apiKey}`,
      },
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HacknPlan API error (${response.status}): ${text}`);
    }

    return (await response.json()) as HacknPlanDesignElement;
  }

  /**
   * Delete a design element
   *
   * @param projectId - Target project ID
   * @param elementId - Design element ID to delete
   */
  async deleteDesignElement(projectId: number, elementId: number): Promise<void> {
    const url = `${this.baseUrl}/projects/${projectId}/designdocs/elements/${elementId}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `ApiKey ${this.apiKey}`,
      },
    });

    if (!response.ok && response.status !== 404) {
      const text = await response.text();
      throw new Error(`HacknPlan API error (${response.status}): ${text}`);
    }
  }
}
