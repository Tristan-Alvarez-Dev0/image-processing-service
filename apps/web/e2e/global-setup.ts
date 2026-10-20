import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { makeFixtures } from '../../api/test/support/fixtures.js';
import { makeVideoFixtures } from '../../api/test/support/videos.js';

/** Serves generated test media on 127.0.0.1, standing in for a remote image host. */
export default async function globalSetup() {
  const [images, videos] = await Promise.all([makeFixtures(), makeVideoFixtures()]);
  const files: Record<string, [string, Buffer | string]> = {
    '/photo.jpg': ['image/jpeg', images.jpeg],
    '/alpha.png': ['image/png', images.png],
    '/clip.mp4': ['video/mp4', videos.redThenBlue],
    '/page.html': ['text/html', '<html>not an image</html>'],
  };

  const server = createServer((req, res) => {
    const file = files[req.url ?? ''];
    if (!file) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': file[0] }).end(file[1]);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.FIXTURE_ORIGIN = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return () => new Promise<void>((resolve) => server.close(() => resolve()));
}
