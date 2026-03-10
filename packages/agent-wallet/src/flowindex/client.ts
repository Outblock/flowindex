/**
 * FlowIndex API client — thin wrapper around the FlowIndex REST API.
 *
 * Default base URL is https://flowindex.io/api. The API routes live under
 * /api/flow/... on the public domain.
 */
export class FlowIndexClient {
  constructor(private baseUrl: string) {}

  private async get(path: string): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(
        `FlowIndex API error ${resp.status}: ${await resp.text()}`,
      );
    }
    return resp.json();
  }

  async getAccount(address: string): Promise<unknown> {
    return this.get(`/flow/account/${address}`);
  }

  async getFlowBalance(address: string): Promise<unknown> {
    // FLOW balance is included in the FT vaults response
    const result = (await this.get(`/flow/account/${address}/ft`)) as {
      data?: Array<{ token?: string; balance?: string }>;
    };
    const flowVault = result.data?.find((v) =>
      v.token?.includes('FlowToken'),
    );
    return {
      address,
      balance: flowVault?.balance ?? '0.0',
    };
  }

  async getFtBalances(address: string): Promise<unknown> {
    return this.get(`/flow/account/${address}/ft`);
  }

  async getNftCollections(address: string): Promise<unknown> {
    return this.get(`/flow/account/${address}/nft`);
  }

  async getTransaction(txId: string): Promise<unknown> {
    return this.get(`/flow/transaction/${txId}`);
  }
}
