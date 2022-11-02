const axios = require("axios");
const get = require("lodash/get");
const normalize = require("./normalize");
const polyfill = require("babel-polyfill");

function getApi() {
  const rateLimit = 500;
  let lastCalled = null;

  const rateLimiter = call => {
    const now = Date.now();
    if (lastCalled) {
      lastCalled += rateLimit;
      const wait = lastCalled - now;
      if (wait > 0) {
        return new Promise(resolve => setTimeout(() => resolve(call), wait));
      }
    }
    lastCalled = now;
    return call;
  };

  const api = axios.create({
    baseURL: "https://www.googleapis.com/youtube/v3/"
  });

  api.interceptors.request.use(rateLimiter);

  return api;
}

exports.sourceNodes = async (
  { actions, store, cache, createNodeId },
  { channelId, apiKey, maxVideos = 50 }
) => {
  const { createNode } = actions;

  const createVideoNodesFromChannelId = async (channelId, apiKey) => {
    var api = getApi();
    let videos = [];
    let pageSize = Math.min(50, maxVideos);
    const playlistsResp = await api.get(
      `playlists?part=contentDetails&channelId=${channelId}&key=${apiKey}&maxResults=${pageSize}`
    );

    const playlistsData = playlistsResp.data.items;
    if (!!playlistsData) {
      for (let i = 0; i < playlistsData.length; i++) {
        let playlistId = playlistsData[i].id;
        let videoResp = await api.get(
          `playlistItems?part=snippet%2CcontentDetails%2Cstatus&maxResults=${pageSize}&playlistId=${playlistId}&key=${apiKey}`
        );
        videos.push(...videoResp.data.items);

        while (videoResp.data.nextPageToken && videos.length < maxVideos) {
          pageSize = Math.min(50, maxVideos - videos.length);
          let nextPageToken = videoResp.data.nextPageToken;
          for (let i = 0; i < playlistsData.length; i++) {
            let playlistId = playlistsData[i].id;
            let videoResp = await api.get(
              `playlistItems?part=snippet%2CcontentDetails%2Cstatus&maxResults=${pageSize}&pageToken=${nextPageToken}&playlistId=${playlistId}&key=${apiKey}`
            );
            videos.push(...videoResp.data.items);
          }
        }
      }
    }

    videos = normalize.normalizeRecords(videos);
    videos = normalize.createGatsbyIds(videos, createNodeId);
    videos = await normalize.downloadThumbnails({
      items: videos,
      store,
      cache,
      createNode
    });
    normalize.createNodesFromEntities(videos, createNode);

    return;
  }

  try {
    if (Array.isArray(channelId)) {
      await Promise.all(channelId.map(async (channelIdEntry) => createVideoNodesFromChannelId(channelIdEntry, apiKey)));
    }
    else {
      await createVideoNodesFromChannelId(channelId, apiKey);
    }
    return;
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};
