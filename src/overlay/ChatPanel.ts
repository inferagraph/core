export class ChatPanel {
  private element: HTMLElement | null = null;
  private onSubmit: ((question: string) => void) | null = null;

  attach(parent: HTMLElement): void {
    this.element = document.createElement('div');
    this.element.className = 'ig-chat-panel';
    this.element.style.display = 'none';
    parent.appendChild(this.element);
  }

  show(): void {
    if (this.element) {
      this.element.style.display = 'block';
    }
  }

  hide(): void {
    if (this.element) {
      this.element.style.display = 'none';
    }
  }

  setOnSubmit(handler: (question: string) => void): void {
    this.onSubmit = handler;
  }

  submitQuestion(question: string): void {
    this.onSubmit?.(question);
  }

  detach(): void {
    this.element?.remove();
    this.element = null;
    this.onSubmit = null;
  }
}
