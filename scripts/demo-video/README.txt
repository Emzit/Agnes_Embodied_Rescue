五分钟演示剪辑工具

在 /data-ssd/zhongchengkai/agnes 工作区运行。所有输入、输出、证据文件必须留在该工作区。
1. 保存未经改动的真实屏幕录制 WebM，核对每个镜头的动作、时间与 AGH 结果。
2. 复制 timeline.template.json 到 artifacts/demo-video-20261013/；替换实际素材路径、SHA256、原始秒数、阶段文案和证据文件。
   模板是分镜计划，不是已发生的录像记录；review.verified 默认 false。
3. 先验证：
   python3 -B scripts/demo-video/edit-video.py --timeline artifacts/demo-video-20261013/timeline.json --output artifacts/demo-video-20261013/final/demo.mp4 --check
4. 校验通过后去掉 --check 编码。输出 MP4、.zh-CN.srt、.zh-CN.ass、.edit-manifest.json 与 .edit-work/。
   输出默认 1920x1080 / 30 FPS / H.264，原片有音频则保留 AAC。不插入补帧，不循环动作，不裁剪原画面。
   原片无音频就输出无音轨；项目讲解由下方独立旁白混音步骤加入。MP4 包含默认中文字幕轨；同时交付UTF-8字幕文件，便于播放器/剪辑器显示。
   可使用项目内已保存并附许可证的 Noto Sans CJK SC 字体烧录中文字幕；同时保留默认字幕轨与 SRT/ASS。
5. 单源片段必须时间递增且不重叠。概览原速；动作可在核查完整过程后以1–4倍展示（填写speed_reason），等待最高32倍，均显示倍速。
   每段前跳过的来源区间须填写 omitted_before_reason，自动写入剪辑清单并显示等待剪辑说明。
6. target_duration通常300，默认容差15秒。工具不会循环/冻结/虚构镜头来填到5分钟。
7. ending.result允许 search_incomplete / observation_only / located_and_stopped。
   located_and_stopped必须附真实人员观测与停止状态证据文件；接近人员不等于物理搬运救出。
   evidence 是工作区相对文件路径数组；工具记录对应 SHA256 供人工核对。
8. --technical-validation 仅用于明确标注的合成编码测试，输入输出限 artifacts/demo-video-20261013/edit-validation/。
   合成测试不可作为参赛演示录像。禁止覆盖既有输出，修订时使用新文件名。

Chinese burn-in subtitles (recommended for the final video):
  Add --font-dir artifacts/demo-video-20261013/assets/fonts to edit-video.py.
  The licensed official Noto Sans CJK SC font, OFL and source hashes are retained there.
  The editor preserves an MP4 subtitle track and SRT/ASS while burning readable Chinese into the frames.

Final delivery:
  Write the reviewed real edit to artifacts/demo-video-20261013/final/demo.mp4.
  http://127.0.0.1:4177/demo-video serves only this final MP4 and its subtitle/edit manifest.
  Technical test videos are never served from the final viewer.

Chinese narration mix (after the real silent edit has been reviewed):
  python3 -B scripts/demo-video/mix-narration.py --video artifacts/demo-video-20261013/final/demo-silent.mp4 --timeline artifacts/demo-video-20261013/narration-timeline.json --output artifacts/demo-video-20261013/final/demo.mp4 --check
  Remove --check to write a new voiced MP4. The source and destination must differ;
  the original video, existing output and manifest are never overwritten.
  The input must already be about five minutes, H.264, silent, and bound by its
  .edit-manifest.json SHA256. Video and subtitle streams are copied unchanged.
  Narration starts refer to final edited seconds, never source or simulation time.
  Timeline schema:
    {"version":1,"clips":[{"id":"opening","start":0,"file":"artifacts/.../opening.wav",
      "text":"对应项目讲解","source":{"kind":"local_voice_synthesis",
      "description":"说明实际录音或本地合成方式","provenance_file":"artifacts/.../voice-source.json"}}],
      "background":{"file":"artifacts/.../music.wav","gain_db":-28,"loop":true,
      "source":{"kind":"original_procedural_audio","description":"原创背景音来源"}}}
  Each clip may specify sha256 and gain_db (-24 to +12 dB). Clips must be
  chronological, nonoverlapping and fit within the existing video. The optional
  background is kept low (-60 to -18 dB); looping repeats audio only.
  The new edit manifest retains all original execution/edit evidence and adds
  per-clip hashes, duration, timing, text, source provenance and mixing settings.
  A copied encoded video-packet hash verifies that no video content was changed.
  --technical-validation is limited to edit-validation/ and requires an explicitly
  labelled SYNTHETIC_CODEC_VALIDATION_NOT_DEMO input manifest. Such a clip is never
  served as the competition demonstration.
