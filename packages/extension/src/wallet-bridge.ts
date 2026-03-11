// =============================================================================
// Wallet Bridge — detect MetaMask/TrustWallet, connect, listen for changes
// =============================================================================

export interface WalletConnection {
  address: string;
  chainId: number;
}

// Minimal EIP-1193 provider interface
interface EIP1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
}

function getEthereumProvider(): EIP1193Provider | null {
  const win = window as unknown as { ethereum?: EIP1193Provider };
  return win.ethereum ?? null;
}

// ---------------------------------------------------------------------------
// Connect wallet (requests accounts from MetaMask/TrustWallet)
// ---------------------------------------------------------------------------

export async function connectWallet(): Promise<WalletConnection> {
  const provider = getEthereumProvider();
  if (!provider) {
    throw new Error('No Web3 wallet detected. Install MetaMask or TrustWallet.');
  }

  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
  if (!accounts || accounts.length === 0) {
    throw new Error('No accounts returned from wallet.');
  }

  const chainIdHex = (await provider.request({ method: 'eth_chainId' })) as string;
  const chainId = parseInt(chainIdHex, 16);

  return { address: accounts[0], chainId };
}

// ---------------------------------------------------------------------------
// Get current connection without prompting
// ---------------------------------------------------------------------------

export async function getConnection(): Promise<WalletConnection | null> {
  const provider = getEthereumProvider();
  if (!provider) return null;

  try {
    const accounts = (await provider.request({ method: 'eth_accounts' })) as string[];
    if (!accounts || accounts.length === 0) return null;
    const chainIdHex = (await provider.request({ method: 'eth_chainId' })) as string;
    return { address: accounts[0], chainId: parseInt(chainIdHex, 16) };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Listen for account / chain changes
// ---------------------------------------------------------------------------

export type WalletEventHandler = (connection: WalletConnection | null) => void;

export function listenForWalletChanges(handler: WalletEventHandler): () => void {
  const provider = getEthereumProvider();
  if (!provider) return () => undefined;

  const onAccountsChanged = (accounts: unknown) => {
    const accs = accounts as string[];
    if (!accs || accs.length === 0) {
      handler(null);
    } else {
      provider.request({ method: 'eth_chainId' }).then((hex) => {
        handler({ address: accs[0], chainId: parseInt(hex as string, 16) });
      }).catch(() => handler(null));
    }
  };

  const onChainChanged = () => {
    getConnection().then(handler).catch(() => handler(null));
  };

  provider.on('accountsChanged', onAccountsChanged);
  provider.on('chainChanged', onChainChanged);

  return () => {
    provider.removeListener('accountsChanged', onAccountsChanged);
    provider.removeListener('chainChanged', onChainChanged);
  };
}

// ---------------------------------------------------------------------------
// Check if we're on BSC mainnet (chainId 56)
// ---------------------------------------------------------------------------

export function isBscMainnet(chainId: number): boolean {
  return chainId === 56;
}
