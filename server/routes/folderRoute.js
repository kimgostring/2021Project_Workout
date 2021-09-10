const { Router } = require("express");
const { isValidObjectId } = require("mongoose");
const { Video, Folder, User } = require("../models");
const { folderVideoRouter } = require("./folder");
const {
  getVideosFromPlaylistId,
  rmSameVideos,
} = require("../middlewares/youtube");

const folderRouter = Router();

folderRouter.use("/:folderId/videos", folderVideoRouter);

// folder 생성
folderRouter.post(
  "/",
  getVideosFromPlaylistId,
  rmSameVideos,
  async (req, res) => {
    try {
      const { youtubePlaylistName, videos } = req;
      const { userId, sharingLevel = 1, tags, name } = req.body;
      // 유저 확인
      if (!userId || !isValidObjectId(userId))
        return res.status(400).send({ err: "invalid user id. " });
      const user = await User.findOne({ _id: userId });
      if (!user) return res.status(400).send({ err: "user does not exist. " });

      // name 확인
      if (!(name || youtubePlaylistName))
        return res
          .status(400)
          .send({ err: "name or youtubePlaylistId is required." });
      // sharingLevel 확인
      if (!(sharingLevel === 1 || sharingLevel === 2 || sharingLevel === 3))
        return res
          .status(400)
          .send({ err: "sharingLevel must be a 1-3 integer. " });
      // tags 확인
      if (tags) {
        if (!Array.isArray(tags))
          return res.status(400).send({ err: "tags must be an array." });
        if (!tags.every((tag) => typeof tag === "string" && tag.length <= 10))
          return res
            .status(400)
            .send({ err: "each tag must be a string within 10 chars. " });
      }

      // video에 folder 추가 후 folder에 추가
      const folder = new Folder({
        ...req.body,
        name: `${name ? `${name}` : `${youtubePlaylistName}`}`,
        user: user._id,
        videos,
      });
      videos.forEach((video) => {
        video.folder = folder;
        video.user = user._id;
      });

      await Promise.all([folder.save(), Video.insertMany(videos)]);
      res.send({ success: true, folder });
    } catch (err) {
      return res.status(400).send({ err: err.message });
    }
  }
);

// 전체 folder 읽기
folderRouter.get("/", async (req, res) => {
  try {
    let { keyword, sort, strict } = req.query;
    if (keyword && isValidObjectId(keyword))
      // keyword로 id 넘어온 경우
      keyword = { _id: keyword, sharingLevel: { $gte: 2 } };
    // id가 아닌 경우, 키워드 검색
    else if (keyword && strict === "true")
      // strict 옵션 있을 경우, 입력된 문장과 띄어쓰기까지 완전히 일치하는 것 골라옴
      keyword = { $text: { $search: `"${keyword}"` }, sharingLevel: 3 };
    else if (keyword)
      keyword = { $text: { $search: keyword }, sharingLevel: 3 };
    else keyword = { sharingLevel: 3 }; // 기본 검색
    if (sort)
      switch (sort) {
        case "asc": // 오름차순
          sort = { name: 1 };
          break;
        case "des": // 내림차순
          sort = { name: -1 };
          break;
        case "desShared": // 공유많은순
          sort = { sharedCount: -1 };
          break;
        case "latest": // 최신순
          sort = { createdAt: -1 };
          break;
        default:
          return res.status(400).send({ err: "invalid sort. " });
      }
    else sort = { sharedCount: -1 }; // 기본 정렬

    const folders = await Folder.find(keyword).sort(sort); // 기본 정렬
    res.send({ success: true, folders });
  } catch (err) {
    return res.status(400).send({ err: err.message });
  }
});

// 특정 folder 읽기
folderRouter.get("/:folderId", async (req, res) => {
  try {
    const { folderId } = req.params;
    if (!isValidObjectId(folderId))
      return res.status(400).send({ err: "invalid folder id. " });

    const folder = await Folder.findOne({ _id: folderId });
    if (!folder)
      return res.status(400).send({ err: "folder does not exist. " });

    res.send({ success: true, folder });
  } catch (err) {
    return res.status(400).send({ err: err.message });
  }
});

// folder 수정
folderRouter.patch("/:folderId", async (req, res) => {
  try {
    const { folderId } = req.params;
    const { name, sharingLevel, tags } = req.body;
    if (!isValidObjectId(folderId))
      return res.status(400).send({ err: "invaild folder id. " });

    // 수정사항 없는 경우
    if (!name && !sharingLevel && !tags)
      return res
        .status(400)
        .send({ err: "at least one of information must be required. " });
    // name 확인
    if (name !== undefined && (typeof name !== "string" || name.length <= 0))
      return res.status(400).send({ err: "name must be a string. " });
    // sharingLevel 확인
    if (
      sharingLevel !== undefined &&
      !(sharingLevel === 1 || sharingLevel === 2 || sharingLevel === 3)
    )
      return res
        .status(400)
        .send({ err: "sharingLevel must be a 1-3 integer. " });
    // tags 확인
    if (tags) {
      if (!Array.isArray(tags))
        return res.status(400).send({ err: "tags must be an array." });
      if (!tags.every((tag) => typeof tag === "string" && tag.length <= 10))
        return res
          .status(400)
          .send({ err: "each tag must be a string within 10 chars. " });
    }

    let promises = Promise.all([
      Folder.findOneAndUpdate({ _id: folderId }, req.body, {
        new: true,
      }),
    ]);

    // name 또는 sharingLevel 바뀔 경우, 내장 영상들 정보도 수정되어야 함
    let videosUpdateObj = {};
    if (name) videosUpdateObj = { ...videosUpdateObj, "folder.name": name };
    if (sharingLevel)
      videosUpdateObj = {
        ...videosUpdateObj,
        "folder.sharingLevel": sharingLevel,
      };
    if (name || sharingLevel)
      promises = Promise.all([
        promises,
        Video.updateMany({ "folder._id": folderId }, videosUpdateObj),
      ]);

    const [folder] = await promises;
    res.send({ success: true, folder });
  } catch (err) {
    return res.status(400).send({ err: err.message });
  }
});

// folder 삭제
folderRouter.delete("/:folderId", async (req, res) => {
  try {
    const { folderId } = req.params;
    if (!isValidObjectId(folderId))
      return res.status(400).send({ err: "folder id is invaild. " });

    const folder = await Folder.findOne({ _id: folderId });
    if (!folder)
      return res.status(400).send({ err: "folder does not exist. " });
    if (folder.isDefault)
      return res.status(400).send({ err: "default folder cannot delete. " });

    // 폴더 삭제하는 작업 프로미스에 추가
    let promises = Promise.all([
      Folder.deleteOne({ _id: folderId, isDefault: false }),
    ]);

    if (
      folder.videos &&
      Array.isArray(folder.videos) &&
      folder.videos.length !== 0
    ) {
      // 폴더 안에 video 있는 경우 영상 기본폴더로 강등 필요
      const defaultFolder = await Folder.findOne({
        user: folder.user,
        isDefault: true,
      });
      if (!defaultFolder)
        return res.status(400).send({ err: "default folder does not exist. " });

      promises = Promise.all([
        promises,
        Video.updateMany({ "folder._id": folderId }, { folder: defaultFolder }), // 기본폴더로 강등
        defaultFolder.updateOne({
          // 기본폴더에 영상 추가
          $push: { videos: { $each: folder.videos } },
        }),
      ]);
    }

    await promises;
    res.send({ success: true, folder });
  } catch (err) {
    return res.status(400).send({ err: err.message });
  }
});

// 폴더 북마크, controller resource
folderRouter.post("/:folderId/bookmark", async (req, res) => {
  try {
    const { folderId } = req.params;
    if (!isValidObjectId(folderId))
      return res.status(400).send({ err: "invalid folder id. " });

    const folder = await Folder.findOneAndUpdate(
      { _id: folderId, isBookmarked: false },
      { isBookmarked: true },
      { new: true }
    );

    if (!folder)
      return res.status(400).send({
        err: "folder does not exist, or already bookmarked folder. ",
      });

    res.send({ success: true, folder });
  } catch (err) {
    return res.status(400).send({ err: err.message });
  }
});

// 폴더 북마크 해제, controller resource
folderRouter.post("/:folderId/unbookmark", async (req, res) => {
  try {
    const { folderId } = req.params;
    if (!isValidObjectId(folderId))
      return res.status(400).send({ err: "invalid folder id. " });

    const folder = Folder.findOneAndUpdate(
      { _id: folderId, isBookmarked: true },
      { isBookmarked: false },
      { new: true }
    );

    if (!folder)
      return res.status(400).send({
        err: "folder does not exist, or already unbookmarked folder. ",
      });

    res.send({ success: true, folder });
  } catch (err) {
    return res.status(400).send({ err: err.message });
  }
});

// 폴더 복사하기, controller resource
folderRouter.post("/:folderId/copy", async (req, res) => {
  try {
    const { folderId: originFolderId } = req.params;
    const { userId } = req.body;
    if (!userId || !isValidObjectId(userId))
      return res.status(400).send({ err: "invaild user id. " });
    if (!isValidObjectId(originFolderId))
      return res.status(400).send({ err: "invaild folder id. " });

    const [originFolder, user] = await Promise.all([
      Folder.findOne({ _id: originFolderId }),
      User.findOne({ _id: userId }),
    ]);
    if (!originFolder)
      return res.status(400).send({ err: "folder does not exist. " });
    if (!user) return res.status(400).send({ err: "user does not exist. " });
    if (
      // 내 폴더가 아닌 폴더를 복사할 때, sharingLevel이 1이면 권한 없음
      originFolder.sharingLevel === 1 &&
      originFolder.user.toString() !== userId
    )
      return res.status(400).send({ err: "folder disabled for coyping. " });

    // 새 폴더 생성
    newFolder = new Folder({
      name: originFolder.name,
      youtubeId: originFolder.youtubeId,
      tags: originFolder.tags,
      user: user._id,
    });

    // 새 영상들 생성
    const originVideos = await Video.find({
      _id: {
        $in: originFolder.videos.map((video) => {
          return video._id;
        }),
      },
    });
    const newVideos = originVideos.map((originVideo) => {
      const newVideo = new Video({
        title: originVideo.title,
        youtubeId: originVideo.youtubeId,
        thumbnail: originVideo.thumbnail,
        originDuration: originVideo.originDuration,
        duration: originVideo.duration,
        tags: originVideo.tags,
        "folder._id": newFolder._id,
        "folder.name": newFolder.name,
        "folder.sharingLevel": newFolder.sharingLevel,
        user: user._id,
      });
      if (originVideo.start !== undefined) newVideo.start = originVideo.start;
      if (originVideo.end !== undefined) newVideo.end = originVideo.end;

      return newVideo;
    });

    // 새 폴더에 영상들 넣어주기
    newFolder.videos = newVideos;

    const [countedOriginFolder] = await Promise.all([
      Folder.findOneAndUpdate(
        { _id: originFolderId, user: { $ne: user._id } },
        { $inc: { sharedCount: 1 } },
        { new: true }
      ),
      Video.updateMany(
        { "folder._id": originFolderId, user: { $ne: user._id } },
        { $inc: { sharedCount: 1 } }
      ),
      newFolder.save(),
      Video.insertMany(newVideos),
    ]);

    res.send({
      success: true,
      newFolder,
      newVideos,
      originFolder: countedOriginFolder ? countedOriginFolder : originFolder,
    });
  } catch (err) {
    return res.status(400).send({ err: err.message });
  }
});

// 기본폴더로 지정, controller resource
folderRouter.post("/:folderId/setAsDefault", async (req, res) => {
  try {
    const { folderId } = req.params;
    const { userId } = req.body;
    if (!userId || !isValidObjectId(userId))
      return res.status(400).send({ err: "invaild user id. " });
    if (!isValidObjectId(folderId))
      return res.status(400).send({ err: "invaild folder id. " });

    const [newDefaultFolder, oldDefaultFolder] = await Promise.all([
      Folder.findOne({ _id: folderId, user: userId }),
      Folder.findOne({ user: userId, isDefault: true }),
    ]);
    if (!oldDefaultFolder)
      return res.status(400).send({
        err: "user does not exist, or default folder does not exist. ",
      });
    if (!newDefaultFolder)
      return res.status(400).send({
        err: "folder does not exist, or user does not have this folder. ",
      });
    if (newDefaultFolder.isDefault)
      return res.status(400).send({ err: "already default folder. " });

    newDefaultFolder.isDefault = true;
    oldDefaultFolder.isDefault = false;

    await Promise.all([newDefaultFolder.save(), oldDefaultFolder.save()]);
    res.send({ success: true, newDefaultFolder, oldDefaultFolder });
  } catch (err) {
    return res.status(400).send({ err: err.message });
  }
});

module.exports = { folderRouter };