import qs from 'qs';
import { Router, UiState } from '../../types';

type CreateURL<TRouteState> = (args: {
  qsModule: typeof qs;
  routeState: TRouteState;
  location: Location;
}) => string;

type ParseURL<TRouteState> = (args: {
  qsModule: typeof qs;
  location: Location;
}) => TRouteState;

type BrowserHistoryArgs<TRouteState> = {
  windowTitle?: (routeState: TRouteState) => string;
  writeDelay: number;
  createURL: CreateURL<TRouteState>;
  parseURL: ParseURL<TRouteState>;
};

const setWindowTitle = (title?: string): void => {
  if (title) {
    window.document.title = title;
  }
};

class BrowserHistory<TRouteState> implements Router<TRouteState> {
  /**
   * Transforms a UI state into a title for the page.
   */
  private readonly windowTitle?: BrowserHistoryArgs<TRouteState>['windowTitle'];
  /**
   * Time in milliseconds before performing a write in the history.
   * It prevents from adding too many entries in the history and
   * makes the back button more usable.
   *
   * @default 400
   */
  private readonly writeDelay: Required<
    BrowserHistoryArgs<TRouteState>
  >['writeDelay'];
  /**
   * Creates a full URL based on the route state.
   * The storage adaptor maps all syncable keys to the query string of the URL.
   */
  private readonly _createURL: Required<
    BrowserHistoryArgs<TRouteState>
  >['createURL'];
  /**
   * Parses the URL into a route state.
   * It should be symmetrical to `createURL`.
   */
  private readonly parseURL: Required<
    BrowserHistoryArgs<TRouteState>
  >['parseURL'];

  private writeTimer?: number;
  private _onPopState?(event: PopStateEvent): void;

  /**
   * Initializes a new storage provider that syncs the search state to the URL
   * using web APIs (`window.location.pushState` and `onpopstate` event).
   */
  public constructor({
    windowTitle,
    writeDelay = 400,
    createURL,
    parseURL,
  }: BrowserHistoryArgs<TRouteState>) {
    this.windowTitle = windowTitle;
    this.writeTimer = undefined;
    this.writeDelay = writeDelay;
    this._createURL = createURL;
    this.parseURL = parseURL;

    const title = this.windowTitle && this.windowTitle(this.read());

    setWindowTitle(title);
  }

  /**
   * Reads the URL and returns a syncable UI search state.
   */
  public read(): TRouteState {
    return this.parseURL({ qsModule: qs, location: window.location });
  }

  /**
   * Pushes a search state into the URL.
   */
  public write(routeState: TRouteState): void {
    const url = this.createURL(routeState);
    const title = this.windowTitle && this.windowTitle(routeState);

    if (this.writeTimer) {
      window.clearTimeout(this.writeTimer);
    }

    this.writeTimer = window.setTimeout(() => {
      setWindowTitle(title);
      window.history.pushState(routeState, title || '', url);
      this.writeTimer = undefined;
    }, this.writeDelay);
  }

  /**
   * Sets a callback on the `onpopstate` event of the history API of the current page.
   * It enables the URL sync to keep track of the changes.
   */
  public onUpdate(callback: (routeState: TRouteState) => void): void {
    this._onPopState = event => {
      if (this.writeTimer) {
        window.clearTimeout(this.writeTimer);
        this.writeTimer = undefined;
      }

      const routeState = event.state;

      // At initial load, the state is read from the URL without update.
      // Therefore the state object is not available.
      // In this case, we fallback and read the URL.
      if (!routeState) {
        callback(this.read());
      } else {
        callback(routeState);
      }
    };

    window.addEventListener('popstate', this._onPopState);
  }

  /**
   * Creates a complete URL from a given syncable UI state.
   *
   * It always generates the full URL, not a relative one.
   * This allows to handle cases like using a <base href>.
   * See: https://github.com/algolia/instantsearch.js/issues/790
   */
  public createURL(routeState: TRouteState): string {
    return this._createURL({
      qsModule: qs,
      routeState,
      location: window.location,
    });
  }

  /**
   * Removes the event listener and cleans up the URL.
   */
  public dispose(): void {
    if (this._onPopState) {
      window.removeEventListener('popstate', this._onPopState);
    }

    if (this.writeTimer) {
      window.clearTimeout(this.writeTimer);
    }

    this.write({} as TRouteState);
  }
}

export default function historyRouter<TRouteState = UiState>({
  createURL = ({ qsModule, routeState, location }) => {
    const { protocol, hostname, port = '', pathname, hash } = location;
    const queryString = qsModule.stringify(routeState);
    const portWithPrefix = port === '' ? '' : `:${port}`;

    // IE <= 11 has no proper `location.origin` so we cannot rely on it.
    if (!queryString) {
      return `${protocol}//${hostname}${portWithPrefix}${pathname}${hash}`;
    }

    return `${protocol}//${hostname}${portWithPrefix}${pathname}?${queryString}${hash}`;
  },
  parseURL = ({ qsModule, location }) => {
    // `qs` by default converts arrays with more than 20 items to an object.
    // We want to avoid this because the data structure manipulated can therefore vary.
    // Setting the limit to `100` seems a good number because the engine's default is 100
    // (it can go up to 1000 but it is very unlikely to select more than 100 items in the UI).
    //
    // Using an `arrayLimit` of `n` allows `n + 1` items.
    //
    // See:
    //   - https://github.com/ljharb/qs#parsing-arrays
    //   - https://www.algolia.com/doc/api-reference/api-parameters/maxValuesPerFacet/
    return qsModule.parse(location.search.slice(1), { arrayLimit: 99 });
  },
  writeDelay = 400,
  windowTitle,
}: Partial<BrowserHistoryArgs<TRouteState>> = {}): BrowserHistory<TRouteState> {
  return new BrowserHistory({
    createURL,
    parseURL,
    writeDelay,
    windowTitle,
  });
}
