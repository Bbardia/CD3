const applePlatformPattern = /^(mac|iphone|ipad|ipod)/i;
const appleUserAgentPattern = /Mac OS X|iPhone|iPad|iPod/;

interface UserAgentDataLike {
  readonly platform?: string;
}

/**
 * Report whether the runtime uses the Apple editing convention, where the Command key rather than
 * Control drives undo/redo. `navigator.platform` is deprecated but remains the most widely
 * supported signal, so prefer the modern hint and fall back deliberately.
 */
export function detectApplePlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const userAgentData = (navigator as Navigator & { userAgentData?: UserAgentDataLike })
    .userAgentData;
  const platform = userAgentData?.platform ?? navigator.platform ?? '';
  if (platform !== '') {
    return applePlatformPattern.test(platform);
  }
  return appleUserAgentPattern.test(navigator.userAgent ?? '');
}

/**
 * Report whether a keyboard event originated inside text entry. Editor shortcuts must never steal
 * keystrokes from a form the user is typing into.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (target === null || !(target instanceof Element)) {
    return false;
  }
  if (target instanceof HTMLElement && target.isContentEditable) {
    return true;
  }
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}
