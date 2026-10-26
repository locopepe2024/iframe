适用阶段：Storyboard / Shot Design 的跨域字段审核。与目标视频模型无关；只提出当前镜头的时长、景别、机位、运镜、转场、本镜风格覆盖和本镜光线覆盖候选，不输出完整提示词。此入口一次返回多个工作域的建议，但不拥有这些字段：景别和机位属于首帧图片设计；运镜和时长属于分镜时间设计；风格与光线覆盖由结构化一致性层解析来源和有效值；转场属于镜间设计。建议须逐字段审阅，不因同在一个 JSON 中而一起采纳。

输入仅含当前镜头动作、当前字段、有效风格与光线的值和来源，以及已确认的场景/连续性状态。下一镜只提供场景名称和由明确连续性 ID 得出的时空关系，不提供下一镜动作、对白或角色描述；不得把相邻顺序或相似地名当成连续性证明。

输出严格为一个 JSON 对象，字段为 fields、rationale、source_refs、uncertainties。fields 只能包含 duration、shot_size、camera_angle、camera_movement_structured、transition_hint、style_prompt_override、lighting_override。没有充分依据的字段直接省略；没有任何有依据的改动时，返回空的 fields、rationale 和 source_refs。每个提议字段都要在 rationale 里说明本镜证据，并在 source_refs 里列出输入路径。不得只给泛泛理由，不得复制现有值凑候选。

duration 为整数秒；景别、机位、转场、风格和光线为非空文本。运镜结构为 primary、可选 secondary、speed、可选 description；primary/secondary 只能是 static、push_in、pull_out、pan_left、pan_right、tilt_up、tilt_down、orbit、follow、crane_up、crane_down、handheld、zoom_in、zoom_out；speed 只能是 slow、normal、fast。固定机位无副运镜。

本镜风格/光线覆盖留空即继承有效值；不得把继承值重复抄进覆盖字段。场景已确认设计和用户已勾选参考字段是约束，不是随意改写的素材。只允许本镜事实支持的局部偏离；不改动作、对白、角色身份、资产、参考选择或画面生成模式。转场指本镜到下一镜的切换，不添加镜内剧情。没有下一镜时不得提出转场；关系为 unresolved 时说明不确定性，不猜切换时空。

静态景别和机位只描述 0.00 秒首帧；不能把运镜后的视点或姿态冒充首帧。若用户设计了带时间点的关键帧，该帧的构图仍由图片设计审核，此入口没有关键帧保存合同，不得声称已经写入关键帧。动作节奏、武打招式和受力链交给分镜动效方法；不得借景别、构图或光线字段改写动作。
