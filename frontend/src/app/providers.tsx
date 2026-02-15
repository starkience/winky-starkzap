'use client';

/**
 * Starknet React Providers
 *
 * Uses Cartridge Controller as the sole wallet connector.
 * Session keys are built-in - transactions matching pre-approved
 * policies execute without popups.
 *
 * The Cartridge connector is loaded dynamically (client-side only)
 * because it bundles WASM modules that can't run during Next.js SSR.
 */

import { ReactNode, useState, useEffect } from 'react';
import { sepolia, mainnet } from '@starknet-react/chains';
import {
  StarknetConfig,
  jsonRpcProvider,
  cartridge,
  type Connector,
} from '@starknet-react/core';
import { NETWORK, WINKY_CONTRACT_ADDRESS } from '@/lib/constants';

// Chains configuration
const chains = NETWORK === 'mainnet' ? [mainnet, sepolia] : [sepolia, mainnet];

// Use Cartridge RPC v0_9 endpoints (matching Controller's built-in defaults)
const provider = jsonRpcProvider({
  rpc: (chain) => {
    switch (chain) {
      case mainnet:
        return { nodeUrl: 'https://api.cartridge.gg/x/starknet/mainnet/rpc/v0_9' };
      case sepolia:
      default:
        return { nodeUrl: 'https://api.cartridge.gg/x/starknet/sepolia/rpc/v0_9' };
    }
  },
});

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  const [connectors, setConnectors] = useState<Connector[]>([]);

  // Dynamically import Cartridge Controller after mount (client-side only)
  // The package bundles WASM that can't run during SSR prerendering
  useEffect(() => {
    console.log('[Providers] NETWORK:', NETWORK);
    console.log('[Providers] WINKY_CONTRACT_ADDRESS:', WINKY_CONTRACT_ADDRESS);

    if (!WINKY_CONTRACT_ADDRESS) {
      console.error('[Providers] WINKY_CONTRACT_ADDRESS is falsy! Cannot create connector.');
      return;
    }

    Promise.all([
      import('@cartridge/connector'),
      import('@cartridge/controller'),
      import('starknet'),
    ]).then(([{ ControllerConnector }, _controller, { constants }]) => {
      try {
        const policies = {
          contracts: {
            [WINKY_CONTRACT_ADDRESS]: {
              description: 'WinkyBlink - Blink counter contract',
              methods: [
                {
                  name: 'Record Blink',
                  entrypoint: 'record_blink',
                },
              ],
            },
          },
        };
        console.log('[Providers] Creating ControllerConnector with policies:', JSON.stringify(policies));

        const cartridgeConnector = new ControllerConnector({
          policies,
          // Don't override default chains - Controller has built-in
          // Cartridge RPC endpoints with the correct /rpc/v0_9 suffix
          defaultChainId: NETWORK === 'mainnet'
            ? constants.StarknetChainId.SN_MAIN
            : constants.StarknetChainId.SN_SEPOLIA,
          propagateSessionErrors: true,
        });
        setConnectors([cartridgeConnector as unknown as Connector]);
        console.log('[Providers] Cartridge connector created successfully');
      } catch (err) {
        console.error('Failed to create Cartridge connector:', err);
      }
    }).catch((err) => {
      console.error('Failed to load Cartridge connector:', err);
    });
  }, []);

  return (
    <StarknetConfig
      chains={chains}
      provider={provider}
      connectors={connectors}
      explorer={cartridge}
      defaultChainId={NETWORK === 'mainnet' ? mainnet.id : sepolia.id}
      autoConnect
    >
      {children}
    </StarknetConfig>
  );
}
