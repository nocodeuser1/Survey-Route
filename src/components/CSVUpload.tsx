import { useState, useRef } from 'react';
import { Upload, AlertCircle, CheckCircle } from 'lucide-react';
import { parseCSV, parseExcelFile, ParseResult } from '../utils/csvParser';

interface CSVUploadProps {
  onDataParsed: (data: ParseResult) => void;
}

const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];

export default function CSVUpload({ onDataParsed }: CSVUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      alert('Please upload a CSV or Excel (.xlsx) file');
      return;
    }

    setIsProcessing(true);
    setFileName(file.name);

    try {
      const isExcel = ext === '.xlsx' || ext === '.xls';
      const result = isExcel ? await parseExcelFile(file) : await parseCSV(file);
      onDataParsed(result);
    } catch (error) {
      console.error('Error parsing file:', error);
      alert('Failed to parse file');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div
      className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
        isDragging
          ? 'border-blue-500 bg-blue-50'
          : 'border-gray-300 hover:border-gray-400'
      }`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={handleClick}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        onChange={handleFileSelect}
        className="hidden"
      />

      {isProcessing ? (
        <div className="flex flex-col items-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
          <p className="text-gray-600">Processing {fileName}...</p>
        </div>
      ) : (
        <div className="flex flex-col items-center">
          <Upload className="w-12 h-12 text-gray-400 mb-4" />
          <p className="text-lg font-medium text-gray-700 dark:text-gray-200 mb-2">
            Drop your CSV or Excel file here or click to browse
          </p>
          <p className="text-sm text-gray-500">
            Supports .csv and .xlsx files
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Maximum 500 facilities per upload
          </p>
        </div>
      )}
    </div>
  );
}
