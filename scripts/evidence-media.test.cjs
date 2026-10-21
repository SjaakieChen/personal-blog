const test = require('node:test');
const assert = require('node:assert/strict');
const {youtubeId} = require('../assets/evidence-media');

test('YouTube URLs use exact HTTPS hosts and one valid video identifier', () => {
  const id = 'Abc_123-Xyz';
  for (const url of [
    `https://youtu.be/${id}?si=example`,
    `https://www.youtube.com/watch?v=${id}&t=30`,
    `https://youtube.com/watch?v=${id}`,
    `https://m.youtube.com/watch?v=${id}`
  ]) assert.equal(youtubeId(url), id, url);
  for (const url of [
    `http://youtu.be/${id}`, `https://youtu.be.example.com/${id}`,
    `https://youtube.com.example.com/watch?v=${id}`, `https://example.com/watch?v=${id}`,
    `https://user@youtu.be/${id}`, `https://youtu.be:444/${id}`,
    `https://youtu.be/${id}/other`, `https://youtube.com/embed/${id}`,
    `https://youtube.com/watch?v=${id}&v=${id}`, `https://youtube.com/watch?v=${id}%22`,
    'https://youtu.be/short', 'https://youtu.be/Abc_123-Xyz2',
    'javascript:alert(1)', '//youtu.be/Abc_123-Xyz', null, {}
  ]) assert.equal(youtubeId(url), null, String(url));
});
