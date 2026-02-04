import App from './App'
import { Navigation, Script, Intent } from 'scripting'

;(async () => {

  let initialImage: UIImage | null = null
  try {
    if (Intent?.imagesParameter && Intent.imagesParameter.length > 0) {
      initialImage = Intent.imagesParameter[0]
    } else if (Intent?.fileURLsParameter && Intent.fileURLsParameter.length > 0) {
      initialImage = UIImage.fromFile(Intent.fileURLsParameter[0])
    }
  } catch (e) {
    console.warn('read intent input failed', e)
  }



  if (Intent?.shortcutParameter) {
    if (
      Intent.shortcutParameter.type == 'json' &&
      typeof Intent.shortcutParameter.value === 'object' &&
      Intent.shortcutParameter.value !== null &&
      !Array.isArray(Intent.shortcutParameter.value) &&
      (Intent.shortcutParameter.value as Record<string, any>).app
    ) {
      await Intent.continueInForeground("Do you want to open the app and continue?", {
        alwaysConfirm: false
      });
      await Navigation.present({ element: <App initialImage={initialImage} /> })
      Script.exit()
    }
    if (!initialImage) return Script.exit(Intent.text('未提供图片'))

    // // 可选：返回到快捷指令界面
    // Safari.openURL("shortcuts://");

    // If invoked from Shortcuts, perform headless recognition and return result to the shortcut
    let clean: UIImage = initialImage
    try {
      const rendered = initialImage.renderedIn({ width: initialImage.width, height: initialImage.height })
      if (rendered != null) clean = rendered
    } catch (e) {
      console.warn('normalize image failed', e)
    }

    try {
      const result = await (Vision as any).recognizeText(clean, {
        recognitionLevel: 'accurate',
        recognitionLanguages: ['zh-Hans', 'en'],
        usesLanguageCorrection: true,
      })

      const recognized = (result.candidates as any[]).map((c: any, i: number) => ({
        index: i + 1,
        content: c.content as string,
        confidence: c.confidence as number,
        boundingBox: c.boundingBox as { x: number; y: number; width: number; height: number },
      }))

      const text = recognized.map(r => `${r.content}`).join('\n\n')
      Script.exit(Intent.text(text))
      return
    } catch (e) {
      console.warn('vision recognize failed', e)
      return Script.exit(Intent.text('识别失败'))
    }
  }

  await Navigation.present({ element: <App initialImage={initialImage} /> })
  Script.exit()
  
})()
