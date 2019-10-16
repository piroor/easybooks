import childProcess from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { promisify } from 'util'

import mkdirp from 'mkdirp'

const mkdtemp = promisify(fs.mkdtemp)

import { ReportMessage, Presentation } from '../../ports/presentation'
import {
  BuildBookPorts,
  BuildBookPortsFactory,
} from '../../ports/build-book'
import { ReviewContext } from '.'
import { copyFileRecursive } from '../../files'
import { writeYaml, createCatalog, copyTemplates } from './tasks'
import { extractTemplates } from '../template-files'
import { preparingConfig } from './config'

const reError = /^WARN: review-pdfmaker: (.*\.re):([0-9]+): error: (.+)$/

export const parseReviewMessage = (s: string) => {
  return s
    .split('\n')
    .map(line => {
      const matched = reError.exec(line)
      if (!matched) {
        return null
      } else {
        return {
          file: matched[1],
          line: Number.parseInt(matched[2]),
          message: matched[3],
        }
      }
    })
    .filter(v => v !== null) as ReportMessage[]
}

export const buildPdfByReview = (pres: Presentation, reviewDir: string) => {
  return new Promise<void>((resolve, reject) => {
    pres.progress('ReVIEWCompile')
    let data = ''
    const cp = childProcess
      .spawn('review-pdfmaker', ['config.yml'], {
        cwd: reviewDir,
      })
      .on('close', code => {
        const reports = parseReviewMessage(data)
        reports.forEach(report => pres.error(report))

        if (reports.length === 0) {
          resolve()
        } else {
          reject(data)
        }
      })
      .on('error', err => {
        reject(data)
      })
    cp.stdout.on('data', chunk => {
      data += chunk.toString()
    })
    cp.stderr.on('data', chunk => {
      data += chunk.toString()
    })
  })
}

export const prepareReviewDir = async (
  config: any,
  catalog: any,
  templates: string[],
  sty_templates: any,
  projectDir: string,
  pres: Presentation,
) => {
  process.chdir(projectDir)
  mkdirp.sync('.review')

  const { tasks } = createCatalog(catalog)

  // 1. まず Re:VIEW sty ファイルを展開しておく
  // 上書きの都合上、先にやる必要がある
  if ('url' in sty_templates) {
    const { url, dir } = sty_templates
    pres.info(`style template URL: ${url}/${dir}`)
    await extractTemplates(url, dir, '.review/sty', pres)
  }

  // 大半の書き出しタスクは平行で行える
  await Promise.all([
    writeYaml('.review/catalog.yml', catalog),
    writeYaml('.review/config.yml', config),
    ...tasks,
    copyTemplates(templates),
  ])
}

export const getReviewDir = (projectDir: string) =>
  path.join(projectDir, '.review')

export const createBuildBookByReviewPort: BuildBookPortsFactory<
  ReviewContext
> = ({ pres }, { projectDir }) => {
  const buildPdf: BuildBookPorts['buildPdf'] = async config => {
    const reviewDir = getReviewDir(projectDir)
    const { catalog, templates, sty_templates } = preparingConfig(config)

    await prepareReviewDir(
      config,
      catalog,
      templates,
      sty_templates,
      projectDir,
      pres,
    )
    return buildPdfByReview(pres, reviewDir)
  }
  return { buildPdf }
}