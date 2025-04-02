import { LitElement, html } from "lit";
import { customElement, query } from "lit/decorators.js";

const quickChatPhrases: Record<
  string,
  Array<{ text: string; requiresPlayer: boolean }>
> = {
  help: [{ text: "Please give me troops!", requiresPlayer: false }],
  attack: [{ text: "Attack [P1]!", requiresPlayer: true }],
  defend: [{ text: "Defend [P1]!", requiresPlayer: true }],
  greet: [{ text: "Hello!", requiresPlayer: false }],
  misc: [{ text: "Let’s go!", requiresPlayer: false }],
};

@customElement("chat-modal")
export class ChatModal extends LitElement {
  @query("o-modal") private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  createRenderRoot() {
    return this;
  }

  private previewText: string | null = null;
  private requiresPlayerSelection: boolean = false;
  private players: string[] = ["Slovakia", "Germany", "Japan"];
  private selectedCategory: string | null = null;

  quickChatPhrases: Record<
    string,
    Array<{ text: string; requiresPlayer: boolean }>
  > = {
    help: [{ text: "Please give me troops!", requiresPlayer: false }],
    attack: [{ text: "Attack [P1]!", requiresPlayer: true }],
    defend: [{ text: "Defend [P1]!", requiresPlayer: true }],
    greet: [{ text: "Hello!", requiresPlayer: false }],
    misc: [{ text: "Let's go!", requiresPlayer: false }],
  };

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
    return html`
      <o-modal title="Quick Chat">
        <div class="chat-modal-content">
          <!-- 入力中のチャットプレビュー -->
          <div class="chat-preview">
            <span>${this.previewText || "Select a phrase"}</span>
          </div>

          <!-- カテゴリ選択 -->
          <div class="chat-section">
            <div class="chat-section-title">Categories</div>
            <div class="chat-options">
              ${this.categories.map(
                (category) => html`
                  <button
                    class="chat-option-button ${this.selectedCategory ===
                    category.id
                      ? "selected"
                      : ""}"
                    @click=${() => this.selectCategory(category.id)}
                  >
                    ${category.name}
                  </button>
                `,
              )}
            </div>
          </div>

          <!-- 定型文選択 -->
          ${this.selectedCategory
            ? html`
                <div class="chat-section">
                  <div class="chat-section-title">Phrases</div>
                  <div class="chat-options">
                    ${this.getPhrasesForCategory(this.selectedCategory).map(
                      (phrase) => html`
                        <button
                          class="chat-option-button"
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

          <!-- プレイヤー選択（変数が必要な場合のみ表示） -->
          ${this.requiresPlayerSelection
            ? html`
                <div class="chat-section">
                  <div class="chat-section-title">Select Player</div>
                  <div class="chat-options">
                    ${this.players.map(
                      (player) => html`
                        <button
                          class="chat-option-button"
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

          <!-- 送信ボタン -->
          <div class="chat-send">
            <button
              class="chat-send-button"
              @click=${this.sendChatMessage}
              ?disabled=${!this.previewText}
            >
              Send
            </button>
          </div>
        </div>
      </o-modal>
    `;
  }

  private selectCategory(categoryId: string) {
    this.selectedCategory = categoryId;
    this.previewText = null;
    this.requiresPlayerSelection = false;
    this.requestUpdate();
  }

  private selectPhrase(phrase: { text: string; requiresPlayer: boolean }) {
    this.previewText = phrase.text;
    this.requiresPlayerSelection = phrase.requiresPlayer;
    this.requestUpdate();
  }

  private renderPhrasePreview(phrase: { text: string }) {
    return phrase.text.replace("[P1]", "___"); // 仮表示
  }

  private selectPlayer(player: string) {
    if (this.previewText) {
      this.previewText = this.previewText.replace("[P1]", player);
      this.requiresPlayerSelection = false;
      this.requestUpdate();
    }
  }

  private sendChatMessage() {
    console.log("Sent message:", this.previewText);
    this.previewText = null;
    this.selectedCategory = null;
    this.requiresPlayerSelection = false;
    this.close(); // モーダルを閉じる
  }

  public open() {
    this.modalEl?.open();
  }

  public close() {
    this.modalEl?.close();
  }
}
