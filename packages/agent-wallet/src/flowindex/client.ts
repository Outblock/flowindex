/**
 * FlowIndex API client — thin wrapper around the FlowIndex REST API.
 */
export class FlowIndexClient {
  constructor(private baseUrl: string) {}

  private async get(path: string): Promise<unknown> {
    const resp = await fetch(`${this.baseUrl}${path}`);
    if (!resp.ok) {
      throw new Error(
        `FlowIndex API error ${resp.status}: ${await resp.text()}`,
      );
    }
    return resp.json();
  }

  async getAccount(address: string): Promise<unknown> {
    return this.get(`/flow/v1/account/${address}`);
  }

  async getFlowBalance(address: string): Promise<unknown> {
    return this.get(`/flow/v1/account/${address}/balance`);
  }

  async getFtBalances(address: string): Promise<unknown> {
    return this.get(`/flow/v1/account/${address}/ft`);
  }

  async getNftCollections(address: string): Promise<unknown> {
    return this.get(`/flow/v1/account/${address}/nft`);
  }

  async getTransaction(txId: string): Promise<unknown> {
    return this.get(`/flow/v1/transaction/${txId}`);
  }
}
