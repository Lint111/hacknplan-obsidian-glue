/**
 * HacknPlan HTTP Client
 *
 * Direct HTTP client for HacknPlan API calls, bypassing MCP-to-MCP indirection.
 * Uses built-in fetch (Node.js 18+) with retry logic and exponential backoff.
 */

const BASE_URL = 'https://api.hacknplan.com/v0';
const REQUEST_TIMEOUT = 60000; // 60 seconds

/**
 * Custom error class for HacknPlan API errors
 */
export class HacknPlanAPIError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'HacknPlanAPIError';
    this.status = status;
  }
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * HacknPlan API client with retry logic and error handling
 */
export class HacknPlanClient {
  /**
   * Create a new HacknPlan client
   * @param {string} apiKey - HacknPlan API key
   * @param {string} baseUrl - API base URL (default: https://api.hacknplan.com/v0)
   * @param {number} maxRetries - Maximum retry attempts for transient errors (default: 3)
   */
  constructor(apiKey, baseUrl = BASE_URL, maxRetries = 3) {
    if (!apiKey) {
      throw new Error('HACKNPLAN_API_KEY is required');
    }
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.maxRetries = maxRetries;
  }

  /**
   * Make an HTTP request to the HacknPlan API with timeout
   * @param {string} endpoint - API endpoint (e.g., '/projects/123')
   * @param {string} method - HTTP method (GET, POST, PATCH, PUT, DELETE)
   * @param {object|null} body - Request body (for POST/PATCH/PUT)
   * @returns {Promise<any>} API response
   */
  async request(endpoint, method = 'GET', body = null) {
    const options = {
      method,
      headers: {
        'Authorization': `ApiKey ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    };

    if (body && (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE')) {
      options.body = JSON.stringify(body);
    }

    // Add timeout using AbortController
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    options.signal = controller.signal;

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, options);
      clearTimeout(timeout);

      if (!response.ok) {
        const text = await response.text();
        throw new HacknPlanAPIError(
          `HacknPlan API error ${response.status}: ${text}`,
          response.status
        );
      }

      // Handle 204 No Content
      if (response.status === 204 || response.headers.get('content-length') === '0') {
        return { success: true };
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeout);
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${REQUEST_TIMEOUT}ms`);
      }
      throw error;
    }
  }

  /**
   * Execute an operation with exponential backoff retry logic
   * @param {Function} operation - Async function to execute
   * @returns {Promise<any>} Operation result
   */
  async withRetry(operation) {
    let lastError;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        // Check if error is retryable
        const isRetryable = this.isRetryableError(error);

        if (isRetryable && attempt < this.maxRetries - 1) {
          const backoff = Math.min(1000 * Math.pow(2, attempt), 10000);
          console.error(`[hacknplan-client] Retry ${attempt + 1}/${this.maxRetries} in ${backoff}ms: ${error.message}`);
          await sleep(backoff);
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }

  /**
   * Check if an error is retryable
   * @param {Error} error - The error to check
   * @returns {boolean} True if retryable
   */
  isRetryableError(error) {
    if (error instanceof HacknPlanAPIError) {
      // Rate limit (429) or server errors (5xx) are retryable
      return error.status === 429 || (error.status >= 500 && error.status < 600);
    }
    // Network errors are retryable
    if (error.name === 'FetchError' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      return true;
    }
    return false;
  }

  // ============ DESIGN ELEMENT OPERATIONS ============

  /**
   * Create a new design element
   * @param {number} projectId - Project ID
   * @param {number} typeId - Design element type ID
   * @param {string} name - Element name
   * @param {string} description - Element description (markdown supported)
   * @returns {Promise<object>} Created design element
   */
  async createDesignElement(projectId, typeId, name, description = '') {
    // API expects designElementTypeId, not typeId
    return this.withRetry(() =>
      this.request(`/projects/${projectId}/designelements`, 'POST', {
        designElementTypeId: typeId,
        name,
        description,
      })
    );
  }

  /**
   * Update an existing design element
   * @param {number} projectId - Project ID
   * @param {number} designElementId - Design element ID
   * @param {object} updates - Fields to update (name, description)
   * @returns {Promise<object>} Updated design element
   */
  async updateDesignElement(projectId, designElementId, updates) {
    return this.withRetry(() =>
      this.request(`/projects/${projectId}/designelements/${designElementId}`, 'PATCH', updates)
    );
  }

  /**
   * Get a design element by ID
   * @param {number} projectId - Project ID
   * @param {number} designElementId - Design element ID
   * @returns {Promise<object>} Design element
   */
  async getDesignElement(projectId, designElementId) {
    return this.withRetry(() =>
      this.request(`/projects/${projectId}/designelements/${designElementId}`)
    );
  }

  /**
   * List design elements for a project
   * @param {number} projectId - Project ID
   * @param {number|null} typeId - Filter by type ID (optional)
   * @param {number} offset - Pagination offset (default: 0)
   * @param {number} limit - Pagination limit (default: 50, max: 200)
   * @returns {Promise<object>} List of design elements with pagination info
   */
  async listDesignElements(projectId, typeId = null, offset = 0, limit = 50) {
    let endpoint = `/projects/${projectId}/designelements?offset=${offset}&limit=${limit}`;
    if (typeId !== null) {
      endpoint += `&typeId=${typeId}`;
    }
    return this.withRetry(() => this.request(endpoint));
  }

  /**
   * Delete a design element
   * @param {number} projectId - Project ID
   * @param {number} designElementId - Design element ID
   * @returns {Promise<object>} Deletion result
   */
  async deleteDesignElement(projectId, designElementId) {
    // HacknPlan API requires an empty body for DELETE requests
    return this.withRetry(() =>
      this.request(`/projects/${projectId}/designelements/${designElementId}`, 'DELETE', {})
    );
  }

  // ============ DESIGN ELEMENT TYPE OPERATIONS ============

  /**
   * List design element types for a project
   * @param {number} projectId - Project ID
   * @returns {Promise<object>} List of design element types
   */
  async listDesignElementTypes(projectId) {
    return this.withRetry(() =>
      this.request(`/projects/${projectId}/designelementtypes`)
    );
  }

  // ============ PROJECT OPERATIONS ============

  /**
   * Get project details
   * @param {number} projectId - Project ID
   * @returns {Promise<object>} Project details
   */
  async getProject(projectId) {
    return this.withRetry(() =>
      this.request(`/projects/${projectId}`)
    );
  }

  /**
   * List accessible projects
   * @param {number} offset - Pagination offset
   * @param {number} limit - Pagination limit
   * @returns {Promise<object>} List of projects
   */
  async listProjects(offset = 0, limit = 50) {
    return this.withRetry(() =>
      this.request(`/projects?offset=${offset}&limit=${limit}`)
    );
  }

  // ============ WORK ITEM OPERATIONS ============

  /**
   * List work items with optional filters
   * @param {number} projectId - Project ID
   * @param {object} filters - Optional filters (boardId, categoryId, stageId, etc.)
   * @returns {Promise<object>} List of work items
   */
  async listWorkItems(projectId, filters = {}) {
    const params = new URLSearchParams();
    params.set('offset', filters.offset || 0);
    params.set('limit', filters.limit || 50);

    if (filters.boardId) params.set('boardId', filters.boardId);
    if (filters.categoryId) params.set('categoryId', filters.categoryId);
    if (filters.stageId) params.set('stageId', filters.stageId);
    if (filters.assignedUserId) params.set('assignedUserId', filters.assignedUserId);
    if (filters.milestoneId) params.set('milestoneId', filters.milestoneId);

    return this.withRetry(() =>
      this.request(`/projects/${projectId}/workitems?${params.toString()}`)
    );
  }

  /**
   * Get a work item by ID
   * @param {number} projectId - Project ID
   * @param {number} workItemId - Work item ID
   * @returns {Promise<object>} Work item details
   */
  async getWorkItem(projectId, workItemId) {
    return this.withRetry(() =>
      this.request(`/projects/${projectId}/workitems/${workItemId}`)
    );
  }

  // ============ TAG OPERATIONS ============

  /**
   * List tags for a project
   * @param {number} projectId - Project ID
   * @returns {Promise<object>} List of tags
   */
  async listTags(projectId) {
    return this.withRetry(() =>
      this.request(`/projects/${projectId}/tags`)
    );
  }
}

/**
 * Create a HacknPlan client from environment variables
 * @returns {HacknPlanClient} Configured client
 */
export function createClientFromEnv() {
  const apiKey = process.env.HACKNPLAN_API_KEY;
  if (!apiKey) {
    throw new Error('HACKNPLAN_API_KEY environment variable is required');
  }
  return new HacknPlanClient(apiKey);
}

export default HacknPlanClient;
