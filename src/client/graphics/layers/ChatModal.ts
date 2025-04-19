import { LitElement, html } from "lit";
import { customElement, queryAsync } from "lit/decorators.js";

import quickChatData from "../../../../resources/QuickChat.json";
import { EventBus } from "../../../core/EventBus";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { SendQuickChatEvent } from "../../Transport";

type QuickChatPhrase = {
  key: string;
  text: string;
  requiresPlayer: boolean;
};

type QuickChatPhrases = Record<string, QuickChatPhrase[]>;

const quickChatPhrases: QuickChatPhrases = quickChatData;

@customElement("chat-modal")
export class ChatModal extends LitElement {
  @queryAsync("o-modal")
  private modalElPromise!: Promise<
    HTMLElement & {
      open: () => void;
      close: () => void;
    }
  >;

  createRenderRoot() {
    return this;
  }

  private players: string[] = [
    "Slovakia",
    "Germany",
    "Japan",
    "Anon",
    "Anon1",
    "Anon2",
    "Anon3",
    "Anon4",
    "Anon5",
    "Anon6",
    "Anon7",
    "Anon8",
    "Anon9",
    "Anon10",
  ];

  private playerSearchQuery: string = "";
  private previewText: string | null = null;
  private requiresPlayerSelection: boolean = false;
  private selectedCategory: string | null = null;
  private selectedPhraseText: string | null = null;
  private selectedPlayer: string | null = null;
  private selectedPhraseTemplate: string | null = null;
  private selectedQuickChatKey: string | null = null;

  private recipient: PlayerView;
  private sender: PlayerView;
  public eventBus: EventBus;
  public g: GameView;

  quickChatPhrases: QuickChatPhrases = quickChatData;

  private categories = [
    { id: "help", name: "Help" },
    { id: "attack", name: "Attack" },
    { id: "defend", name: "Defend" },
    { id: "greet", name: "Greetings" },
    { id: "misc", name: "Miscellaneous" },
  ];

  private getPhrasesForCategory(categoryId: string) {
    return quickChatPhrases[categoryId] ?? [];
  }

  render() {
    const sortedPlayers = [...this.players].sort((a, b) => a.localeCompare(b));
    const filteredPlayers = sortedPlayers.filter((p) =>
      p.toLowerCase().includes(this.playerSearchQuery),
    );
    const otherPlayers = sortedPlayers.filter(
      (p) => !p.toLowerCase().includes(this.playerSearchQuery),
    );
    const displayPlayers = [...filteredPlayers, ...otherPlayers];

    return html`
      <o-modal title="Quick Chat">
        <div class="chat-columns">
          <div class="chat-column">
            <div class="column-title">Category</div>
            ${this.categories.map(
              (cat) => html`
                <button
                  class="chat-option-button ${this.selectedCategory === cat.id
                    ? "selected"
                    : ""}"
                  @click=${() => this.selectCategory(cat.id)}
                >
                  ${cat.name}
                </button>
              `,
            )}
          </div>

          ${this.selectedCategory
            ? html`
                <div class="chat-column">
                  <div class="column-title">Phrase</div>
                  <div class="phrase-scroll-area">
                    ${this.getPhrasesForCategory(this.selectedCategory).map(
                      (phrase) => html`
                        <button
                          class="chat-option-button ${this
                            .selectedPhraseText === phrase.text
                            ? "selected"
                            : ""}"
                          @click=${() => this.selectPhrase(phrase)}
                        >
                          ${this.renderPhrasePreview(phrase)}
                        </button>
                      `,
                    )}
                  </div>
                </div>
              `
            : null}
          ${this.requiresPlayerSelection || this.selectedPlayer
            ? html`
                <div class="chat-column">
                  <div class="column-title">Player</div>
                  <input
                    class="player-search-input"
                    type="text"
                    placeholder="Search player..."
                    .value=${this.playerSearchQuery}
                    @input=${this.onPlayerSearchInput}
                  />
                  <div class="player-scroll-area">
                    ${displayPlayers.map(
                      (player) => html`
                        <button
                          class="chat-option-button ${this.selectedPlayer ===
                          player
                            ? "selected"
                            : ""}"
                          @click=${() => this.selectPlayer(player)}
                        >
                          ${player}
                        </button>
                      `,
                    )}
                  </div>
                </div>
              `
            : null}
        </div>

        <div class="chat-preview">
          ${this.previewText || "Build your message..."}
        </div>

        <div class="chat-send">
          <button
            class="chat-send-button"
            @click=${this.sendChatMessage}
            ?disabled=${!this.previewText}
          >
            Send
          </button>
        </div>
      </o-modal>
    `;
  }

  private selectCategory(categoryId: string) {
    this.selectedCategory = categoryId;
    this.selectedPhraseText = null;
    this.previewText = null;
    this.requiresPlayerSelection = false;
    this.selectedPlayer = null;
    this.requestUpdate();
  }

  private selectPhrase(phrase: QuickChatPhrase) {
    this.selectedPhraseTemplate = phrase.text;
    this.selectedPhraseText = phrase.text;
    this.selectedQuickChatKey = this.getFullQuickChatKey(
      this.selectedCategory!,
      phrase.key,
    );
    this.previewText = phrase.text;
    this.requiresPlayerSelection = phrase.requiresPlayer;
    this.selectedPlayer = null;
    this.requestUpdate();
  }

  private renderPhrasePreview(phrase: { text: string }) {
    return phrase.text.replace("[P1]", "___");
  }

  private selectPlayer(player: string) {
    if (this.previewText) {
      this.previewText = this.selectedPhraseTemplate.replace("[P1]", player);
      this.selectedPlayer = player;
      this.requiresPlayerSelection = false;
      this.requestUpdate();
    }
  }

  private async sendChatMessage() {
    if (this.sender && this.recipient && this.selectedQuickChatKey) {
      const variables = this.selectedPlayer ? { P1: this.selectedPlayer } : {};
      this.eventBus.emit(
        new SendQuickChatEvent(
          this.sender,
          this.recipient,
          this.selectedQuickChatKey,
          variables,
        ),
      );
    }

    this.previewText = null;
    this.selectedCategory = null;
    this.requiresPlayerSelection = false;
    await this.close();
  }

  private onPlayerSearchInput(e: Event) {
    const target = e.target as HTMLInputElement;
    this.playerSearchQuery = target.value.toLowerCase();
    this.requestUpdate();
  }

  private getFullQuickChatKey(category: string, phraseKey: string): string {
    return `${category}.${phraseKey}`;
  }

  public async open(sender?: PlayerView, recipient?: PlayerView) {
    if (sender && recipient) {
      const alivePlayerNames = this.g
        .players()
        .filter((p) => p.isAlive())
        .map((p) => p.data.name);

      this.players = alivePlayerNames;
      this.recipient = recipient;
      this.sender = sender;
    }

    const modal = await this.modalElPromise;
    modal?.open?.();
  }

  public async close() {
    this.selectedCategory = null;
    this.selectedPhraseText = null;
    this.previewText = null;
    this.requiresPlayerSelection = false;
    this.selectedPlayer = null;

    const modal = await this.modalElPromise;
    modal?.close?.();
  }

  public setRecipient(value: PlayerView) {
    this.recipient = value;
  }

  public setSender(value: PlayerView) {
    this.sender = value;
  }
}
