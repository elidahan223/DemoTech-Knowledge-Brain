import { ChatPanel, type ChatPanelProps } from '../../components/chat/ChatPanel';
import { DetailsPanel, type DetailsPanelProps } from '../../components/graph/DetailsPanel';
import { GraphPanel, type GraphPanelProps } from '../../components/graph/GraphPanel';
export function BrainPage({
  active,
  chat,
  graph,
  details,
}: {
  active: boolean;
  chat: ChatPanelProps;
  graph: GraphPanelProps;
  details: DetailsPanelProps;
}) {
  return (
    <main className="workspace" hidden={!active}>
      <ChatPanel {...chat} />
      <GraphPanel {...graph} />
      <DetailsPanel {...details} />
    </main>
  );
}
