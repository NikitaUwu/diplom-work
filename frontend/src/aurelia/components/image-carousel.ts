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
  public zoomOpen = false;
  public zoomScale = 1;

  private readonly minZoom = 0.5;
  private readonly maxZoom = 4;

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

  public get zoomPercent(): number {
    return Math.round(this.zoomScale * 100);
  }

  public get zoomImageStyle(): string {
    return `transform: scale(${this.zoomScale}); transform-origin: center center; max-height: 82vh;`;
  }

  public itemsChanged(): void {
    this.currentIndex = 0;
    this.closeZoom();
  }

  public prev(): void {
    if (!this.canNavigate) {
      return;
    }

    this.currentIndex = (this.currentIndex - 1 + this.safeItems.length) % this.safeItems.length;
    this.resetZoom();
  }

  public next(): void {
    if (!this.canNavigate) {
      return;
    }

    this.currentIndex = (this.currentIndex + 1) % this.safeItems.length;
    this.resetZoom();
  }

  public openZoom(): void {
    if (!this.currentItem) {
      return;
    }

    this.zoomOpen = true;
    this.resetZoom();
  }

  public closeZoom(): void {
    this.zoomOpen = false;
    this.resetZoom();
  }

  public zoomIn(): void {
    this.zoomScale = Math.min(this.maxZoom, Number((this.zoomScale + 0.25).toFixed(2)));
  }

  public zoomOut(): void {
    this.zoomScale = Math.max(this.minZoom, Number((this.zoomScale - 0.25).toFixed(2)));
  }

  public resetZoom(): void {
    this.zoomScale = 1;
  }

  public onZoomWheel(event: WheelEvent): boolean {
    event.preventDefault();
    if (event.deltaY < 0) {
      this.zoomIn();
    } else {
      this.zoomOut();
    }

    return false;
  }
}
