const { isValidObjectId } = require("mongoose");
const { Video, Folder } = require("../models");

const mkVideosFromFolderId = async (req, res, next) => {
  try {
    // 미들웨어 사용된 곳에 따라 다른 컬렉션의 문서 id 주게 됨,
    // 변수명에 따라 각 문서와 관련된 Video 문서들 전부 찾아 리턴
    const { folderId } = req.params;

    if (!isValidObjectId(folderId))
      return res.status(400).send({ err: "invaild folder id. " });

    const originFolder = await Folder.findOne({ _id: folderId });
    if (!originFolder)
      return res.status(404).send({ err: "folder does not exist. " });

    const originVideos = await Promise.all(
      originFolder.videos.map((originVideo) => {
        return Video.findOne({ _id: originVideo._id, user: originFolder.user });
      })
    );

    // 각 video가 제대로 불려와졌는지 확인
    if (
      !originVideos.every(
        (originVideo) => originVideo && isValidObjectId(originVideo._id)
      )
    )
      return res
        .status(404)
        .send({ err: "there is an invalid video in this folder. " });

    // 불러온 video를 토대로 새 video 생성
    const videos = originVideos.map((originVideo) => {
      const video = new Video({
        youtubeId: originVideo.youtubeId,
        title: originVideo.title,
        tags: originVideo.tags,
        originDuration: originVideo.originDuration,
        duration: originVideo.duration,
        thumbnail: originVideo.thumbnail,
      });
      if (originVideo.start !== undefined) video.start = originVideo.start;
      if (originVideo.end !== undefined) video.end = originVideo.end;

      return video;
    });

    req.videos = videos;
    req.originFolder = originFolder;
    req.originVideos = originVideos;

    next();
  } catch (err) {
    return res.status(400).send({ err: err.message });
  }
};

const checkFolderValidation = (req, res, next) => {
  try {
    const { folder, youtubePlaylistTitle } = req;
    const { youtubePlaylistId, title, publicLevel, tags } = req.body;

    if (youtubePlaylistTitle !== undefined) {
      folder.youtubeId = youtubePlaylistId;

      // 새 폴더일 때, youtubePlaylistTitle이 제목 대체 가능
      if (!folder.title) folder.title = youtubePlaylistTitle;
    }

    // title 확인
    if (title !== undefined) {
      if (typeof title !== "string" || title.length <= 0)
        return res.status(400).send({ err: "title must be a string. " });
      folder.title = title;
    }

    // publicLevel 확인
    if (publicLevel !== undefined) {
      if (!(publicLevel === 1 || publicLevel === 2 || publicLevel === 3))
        return res.status(400).send({ err: "publicLevel must be 1, 2 or 3. " });
      folder.publicLevel = publicLevel;
    }

    // tags 확인
    if (tags !== undefined) {
      if (!Array.isArray(tags))
        return res.status(400).send({ err: "tags must be an array. " });
      if (!tags.every((tag) => typeof tag === "string" && tag.length <= 10))
        return res
          .status(400)
          .send({ err: "each tag must be a string within 10 chars. " });
      folder.tags = tags;
    }

    req.folder = folder;

    next();
  } catch (err) {
    return res.status(400).send({ err: err.message });
  }
};

module.exports = {
  mkVideosFromFolderId,
  checkFolderValidation,
};
