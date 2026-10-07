import type { ExternalPluginConfig } from '@windy/interfaces';

const config: ExternalPluginConfig = {
  name: 'windy-plugin-aaz-fleet',
  version: '0.1.4',
  icon: '✈️',
  title: 'AAZ Fleet',
  description: 'Live aircraft tracking on Windy using adsb.lol.',
  author: 'AAZ Aviation',
  desktopUI: 'rhpane',
  mobileUI: 'fullscreen',
  desktopWidth: 320,
  routerPath: '/aaz-fleet',
  private: true,
};

export default config;
