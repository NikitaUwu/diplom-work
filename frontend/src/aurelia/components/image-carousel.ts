import template from './image-carousel.html?raw';

export interface CarouselItem {
  label: string;
  src: string;
}

export class ImageCarousel {
  public static readonly $au = {
    type: 'custom-element',
    name: 'image-carousel',
    template,
    bindables: ['items'],
  };

  public items: CarouselItem[] = [];
  public currentIndex = 0;

  public get safeItems(): CarouselItem[] {
    return Array.isArray(this.items) ? this.items.filter(Boolean) : [];
  }

  public get currentItem(): CarouselItem | null {
    if (this.safeItems.length === 0) {
      return null;
    }

    return this.safeItems[Math.min(this.currentIndex, this.safeItems.length - 1)];
  }

  public get canNavigate(): boolean {
    return this.safeItems.length > 1;
  }

  public get displayIndex(): number {
    return this.currentItem ? this.currentIndex + 1 : 1;
  }

  public itemsChanged(): void {
    this.currentIndex = 0;
  }

  public prev(): void {
    if (!this.canNavigate) {
      return;
    }

    this.currentIndex = (this.currentIndex - 1 + this.safeItems.length) % this.safeItems.length;
  }

  public next(): void {
    if (!this.canNavigate) {
      return;
    }

    this.currentIndex = (this.currentIndex + 1) % this.safeItems.length;
  }
}
