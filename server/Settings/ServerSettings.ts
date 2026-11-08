import 'dotenv/config';
export type ServerSettings = {
  port: number;
  boundPort: number;
  desktop: boolean;
  desktopToken: string | undefined;
};
export function readServerSettings(): ServerSettings {
  const port = Number(process.env.PORT || 3210);
  const desktop = process.env.BRAIN_DESKTOP === '1';
  const desktopToken = process.env.BRAIN_DESKTOP_TOKEN;
  if (desktop && (!desktopToken || desktopToken.length < 32))
    throw new Error('Desktop session token is missing');
  if (!Number.isInteger(port) || (port < 1024 && !(desktop && port === 0)) || port > 65535)
    throw new Error('Invalid port');

  return { port, boundPort: port, desktop, desktopToken };
}
