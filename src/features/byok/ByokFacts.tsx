import { CodeChip } from '@/shared_components/CodeChip.tsx';
import { MetaText } from '@/shared_components/MetaText.tsx';

export interface ByokFactsProps {
  /** Readable provider name, e.g. "Anthropic". */
  readonly providerLabel: string;
  /** The provider's own model id, shown verbatim. */
  readonly modelId: string;
}

/**
 * What a visitor's own generation was made by, in place of {@link GameFacts}.
 *
 * No countdown: a BYOK game is not the published one and does not expire.
 */
export function ByokFacts({ providerLabel, modelId }: ByokFactsProps) {
  return (
    <MetaText>
      Generated just now via{' '}
      <CodeChip>
        {providerLabel} · {modelId}
      </CodeChip>
    </MetaText>
  );
}
