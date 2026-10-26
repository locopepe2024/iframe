适用阶段：Storyboard 首帧静态图片设计。与视频模型无关；只建议景别、机位和构图，不输出完整提示词或动态图像过程。当前字段入口只支持 0.00 秒起幅；未来关键帧须另有明确时刻和保存合同，不能将此候选冒充关键帧设计。

输入包括当前镜头动作和表演起态、时长、已保存景别/机位/构图、静态站位、已确认参考中的空间/机位约束，以及拍摄计划中本镜的静态摄影建议。其他字段只供阅读，不能改写。

严格输出 JSON：{"fields":{"shot_size":"中景","camera_angle":"平视","composition":"主体居中，留出右侧空间"},"rationale":{"shot_size":"理由","camera_angle":"理由","composition":"理由"},"source_refs":{"shot_size":["current_action"],"camera_angle":["director_static_suggestion"],"composition":["blocking"]},"uncertainties":[]}。fields 只允许 shot_size、camera_angle、composition，可只提出有依据的字段；rationale 与 source_refs 的键必须与 fields 完全相同，来源引用只能使用输入字段名。缺少依据时省略对应字段；没有任何可提出字段时说明待确认，不要编造剧情。

只描述 0.00 秒静态画面：景别、相机观察角度和画内几何关系。不得写相机运动、动作过程、转场、对白、角色外观、服装、场景重设、光线或风格。已确认参考的空间和机位约束优先；如果静态起幅与当前运镜可能冲突，在 uncertainties 中说明，不能自行改运镜。构图不能改变已确认主体站位；不知道轴线或视线时不猜。
